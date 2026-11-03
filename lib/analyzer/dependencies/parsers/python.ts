import type {
  DeclaredPackage,
  DependencyFile,
  DependencyPackage,
  LockParseResult,
  ParseResult,
  ResolvedPackage,
} from "@/lib/analyzer/dependencies/types";
import {
  capPackages,
  dedupePackages,
  isValidPythonName,
  isValidVersion,
  normalizePythonName,
  safeJson,
} from "@/lib/analyzer/dependencies/parsers/common";

const PYTHON_LOCKFILES = ["poetry.lock", "uv.lock", "pdm.lock", "Pipfile.lock"] as const;

function parseRequirements(content: string, warnings: string[]): DeclaredPackage[] {
  const declarations: DeclaredPackage[] = [];
  const seen = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\\\s*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(?:-r|--requirement|-c|--constraint)\b/.test(line)) {
      warnings.push("Nested requirement includes were not followed; only requirements.txt was analyzed.");
      continue;
    }
    if (line.startsWith("-") || line.includes("://") || line.includes(" @ ")) continue;

    const withoutComment = line.split(/\s+#/)[0].trim();
    const match = withoutComment.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/);
    if (!match) continue;

    const name = normalizePythonName(match[1]);
    if (!isValidPythonName(name) || seen.has(name)) continue;

    const specifier = (match[2] ?? "").split(";")[0].split(/\s+--/)[0].trim();
    if (!specifier) {
      seen.add(name);
      declarations.push({ name, range: "*", version: null, dev: false, runtime: true });
      continue;
    }

    const exact = specifier.match(/^===?\s*(\S+)$/);
    if (exact) {
      const version = exact[1];
      if (!isValidVersion(version)) {
        warnings.push(`Requirement ${name} had an invalid exact version and was skipped.`);
        continue;
      }
      seen.add(name);
      declarations.push({
        name,
        range: specifier.slice(0, 120),
        version,
        dev: false,
        runtime: true,
      });
      continue;
    }

    if (specifier.startsWith("==") || specifier.startsWith("===")) {
      warnings.push(`Requirement ${name} had an invalid exact version and was skipped.`);
      continue;
    }

    seen.add(name);
    declarations.push({
      name,
      range: specifier.slice(0, 120),
      version: null,
      dev: false,
      runtime: true,
    });
  }

  return declarations;
}

function parseTomlLock(content: string, label: string): LockParseResult {
  const packages: ResolvedPackage[] = [];
  let current: { name: string | null; version: string | null; dev: boolean } | null = null;

  const flush = () => {
    if (!current?.name || !current.version) {
      current = null;
      return;
    }
    const name = normalizePythonName(current.name);
    if (isValidPythonName(name) && isValidVersion(current.version)) {
      packages.push({ name, version: current.version, dev: current.dev });
    }
    current = null;
  };

  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === "[[package]]") {
      flush();
      current = { name: null, version: null, dev: false };
      continue;
    }
    if (!current) continue;
    if (!current.name) {
      const name = line.match(/^name\s*=\s*"([^"]+)"/);
      if (name) current.name = name[1];
    }
    if (!current.version) {
      const version = line.match(/^version\s*=\s*"([^"]+)"/);
      if (version) current.version = version[1];
    }
    if (/^category\s*=\s*"dev"/.test(line) || /^groups\s*=\s*\[[^\]]*"dev"/.test(line)) {
      current.dev = true;
    }
  }
  flush();

  if (packages.length === 0 && content.trim().length > 0) {
    return { packages, warnings: [`${label} did not contain recognizable package entries.`] };
  }
  return { packages, warnings: [] };
}

function parsePipfileLock(content: string, warnings: string[]): ResolvedPackage[] {
  const parsed = safeJson(content);
  if (parsed.malformed || !parsed.data || typeof parsed.data !== "object") {
    warnings.push("Pipfile.lock could not be parsed; resolved dependency versions were skipped.");
    return [];
  }

  const data = parsed.data as { default?: Record<string, unknown>; develop?: Record<string, unknown> };
  const packages: ResolvedPackage[] = [];

  for (const [section, dev] of [
    [data.default, false],
    [data.develop, true],
  ] as const) {
    if (!section || typeof section !== "object") continue;
    for (const [rawName, raw] of Object.entries(section)) {
      if (!raw || typeof raw !== "object") continue;
      const version = (raw as { version?: unknown }).version;
      if (typeof version !== "string" || !/^===?/.test(version)) continue;
      const exact = version.replace(/^===?\s*/, "").trim();
      const name = normalizePythonName(rawName);
      if (!isValidPythonName(name) || !isValidVersion(exact)) continue;
      packages.push({ name, version: exact, dev });
    }
  }

  return packages;
}

export function parsePythonProject(files: DependencyFile[]): ParseResult {
  const warnings: string[] = [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const requirements = byPath.get("requirements.txt");
  const declarations = requirements ? parseRequirements(requirements.content, warnings) : [];
  const declarationMap = new Map(declarations.map((item) => [item.name, item]));

  const lockPaths = PYTHON_LOCKFILES.filter((name) => byPath.has(name));
  if (lockPaths.length > 1) {
    warnings.push(`Multiple Python lockfiles were found; ${lockPaths[0]} is used for resolved versions.`);
  }
  const lockPath = lockPaths[0] ?? null;

  let resolved: ResolvedPackage[] = [];
  if (lockPath) {
    const lock = byPath.get(lockPath)!;
    if (lockPath === "Pipfile.lock") {
      resolved = parsePipfileLock(lock.content, warnings);
    } else {
      const parsed = parseTomlLock(lock.content, lockPath);
      resolved = parsed.packages;
      warnings.push(...parsed.warnings);
    }
  }

  const packages: DependencyPackage[] = [];
  const resolvedNames = new Set<string>();

  for (const entry of resolved) {
    resolvedNames.add(entry.name);
    const declaration = declarationMap.get(entry.name);
    packages.push({
      ecosystem: "PyPI",
      name: entry.name,
      version: entry.version,
      declaredRange: declaration?.range ?? null,
      direct: Boolean(declaration),
      dev: entry.dev || declaration?.dev === true,
      runtime: declaration?.runtime === true,
      manifest: lockPath!,
    });
  }

  for (const declaration of declarations) {
    if (resolvedNames.has(declaration.name)) continue;
    packages.push({
      ecosystem: "PyPI",
      name: declaration.name,
      version: declaration.version,
      declaredRange: declaration.range,
      direct: true,
      dev: declaration.dev,
      runtime: declaration.runtime,
      manifest: requirements ? "requirements.txt" : lockPath!,
    });
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
