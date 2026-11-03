import type {
  DeclaredPackage,
  DependencyFile,
  DependencyPackage,
  ParseResult,
  ResolvedPackage,
} from "@/lib/analyzer/dependencies/types";
import {
  capPackages,
  dedupePackages,
  isValidNpmName,
  isValidVersion,
  normalizeNpmName,
  safeJson,
} from "@/lib/analyzer/dependencies/parsers/common";
import { parsePnpmLock } from "@/lib/analyzer/dependencies/parsers/pnpm";
import { parseYarnLock } from "@/lib/analyzer/dependencies/parsers/yarn";

const NPM_LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;

type PackageJson = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
};

function parsePackageJson(content: string, warnings: string[]): Map<string, DeclaredPackage> {
  const declarations = new Map<string, DeclaredPackage>();
  const parsed = safeJson(content);
  if (parsed.malformed || !parsed.data || typeof parsed.data !== "object") {
    warnings.push("package.json could not be parsed; declared dependency ranges were skipped.");
    return declarations;
  }

  const data = parsed.data as PackageJson;
  const sections: Array<[Record<string, unknown> | undefined, boolean, boolean]> = [
    [data.dependencies, false, true],
    [data.devDependencies, true, false],
    [data.optionalDependencies, false, false],
  ];

  for (const [section, dev, runtime] of sections) {
    if (!section || typeof section !== "object") continue;
    for (const [rawName, rawRange] of Object.entries(section)) {
      const name = normalizeNpmName(rawName);
      if (!isValidNpmName(name) || declarations.has(name)) continue;
      const range = typeof rawRange === "string" ? rawRange.trim().slice(0, 120) : "*";
      declarations.set(name, { name, range: range || "*", version: null, dev, runtime });
    }
  }

  return declarations;
}

function packageNameFromLockPath(path: string): string | null {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index < 0) return null;
  return path.slice(index + marker.length);
}

function parsePackageLock(content: string, warnings: string[]): ResolvedPackage[] {
  const parsed = safeJson(content);
  if (parsed.malformed || !parsed.data || typeof parsed.data !== "object") {
    warnings.push("package-lock.json could not be parsed; resolved dependency versions were skipped.");
    return [];
  }

  const data = parsed.data as {
    packages?: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
  };
  const packages: ResolvedPackage[] = [];

  if (data.packages && typeof data.packages === "object") {
    for (const [path, raw] of Object.entries(data.packages)) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as { version?: unknown; dev?: unknown; link?: unknown };
      if (record.link === true) continue;
      const rawName = packageNameFromLockPath(path);
      if (!rawName || typeof record.version !== "string") continue;
      const name = normalizeNpmName(rawName);
      const version = record.version.trim();
      if (!isValidNpmName(name) || !isValidVersion(version)) continue;
      packages.push({ name, version, dev: record.dev === true });
    }
    return packages;
  }

  function walk(dependencies: Record<string, unknown>) {
    for (const [rawName, raw] of Object.entries(dependencies)) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as { version?: unknown; dev?: unknown; dependencies?: unknown };
      const name = normalizeNpmName(rawName);
      if (typeof record.version === "string") {
        const version = record.version.trim();
        if (isValidNpmName(name) && isValidVersion(version)) {
          packages.push({ name, version, dev: record.dev === true });
        }
      }
      if (record.dependencies && typeof record.dependencies === "object") {
        walk(record.dependencies as Record<string, unknown>);
      }
    }
  }

  if (data.dependencies && typeof data.dependencies === "object") {
    walk(data.dependencies);
  }
  return packages;
}

export function parseNpmProject(files: DependencyFile[]): ParseResult {
  const warnings: string[] = [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const manifest = byPath.get("package.json");
  const lockPaths = NPM_LOCKFILES.filter((name) => byPath.has(name));
  if (lockPaths.length > 1) {
    warnings.push(`Multiple npm lockfiles were found; ${lockPaths[0]} is used for resolved versions.`);
  }

  const declarations = manifest ? parsePackageJson(manifest.content, warnings) : new Map<string, DeclaredPackage>();
  const lockPath = lockPaths[0] ?? null;
  let resolved: ResolvedPackage[] = [];

  if (lockPath) {
    const lock = byPath.get(lockPath)!;
    if (lockPath === "package-lock.json") {
      resolved = parsePackageLock(lock.content, warnings);
    } else if (lockPath === "pnpm-lock.yaml") {
      const parsed = parsePnpmLock(lock.content);
      resolved = parsed.packages;
      warnings.push(...parsed.warnings);
    } else {
      const parsed = parseYarnLock(lock.content);
      resolved = parsed.packages;
      warnings.push(...parsed.warnings);
    }
  }

  const manifestPath = lockPath ?? "package.json";
  const packages: DependencyPackage[] = [];
  const resolvedNames = new Set<string>();

  for (const entry of resolved) {
    resolvedNames.add(entry.name);
    const declaration = declarations.get(entry.name);
    packages.push({
      ecosystem: "npm",
      name: entry.name,
      version: entry.version,
      declaredRange: declaration?.range ?? null,
      direct: Boolean(declaration),
      dev: entry.dev || declaration?.dev === true,
      runtime: declaration?.runtime === true,
      manifest: manifestPath,
    });
  }

  if (!lockPath) {
    for (const declaration of declarations.values()) {
      packages.push({
        ecosystem: "npm",
        name: declaration.name,
        version: null,
        declaredRange: declaration.range,
        direct: true,
        dev: declaration.dev,
        runtime: declaration.runtime,
        manifest: "package.json",
      });
    }
  } else {
    for (const declaration of declarations.values()) {
      if (resolvedNames.has(declaration.name)) continue;
      packages.push({
        ecosystem: "npm",
        name: declaration.name,
        version: null,
        declaredRange: declaration.range,
        direct: true,
        dev: declaration.dev,
        runtime: declaration.runtime,
        manifest: "package.json",
      });
    }
  }

  packages.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.version ?? "").localeCompare(b.version ?? "") ||
      a.manifest.localeCompare(b.manifest),
  );

  return {
    packages: capPackages(dedupePackages(packages), warnings),
    warnings,
  };
}
