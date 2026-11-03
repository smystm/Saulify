import { MAX_UNUSED_FINDINGS } from "@/lib/analyzer/dependencies/limits";
import type { DependencyPackage } from "@/lib/analyzer/dependencies/types";
import type { FetchedFile } from "@/lib/github/client";

const JS_LIKE = /\.(js|jsx|mjs|cjs|ts|tsx)$/i;

const RUNTIME_LOADERS = new Set([
  "dotenv",
  "tslib",
  "core-js",
  "regenerator-runtime",
  "reflect-metadata",
  "@babel/runtime",
  "source-map-support",
]);

function importRoot(specifier: string): string | null {
  const value = specifier.trim();
  if (!value || value.startsWith(".") || value.startsWith("/") || value.startsWith("node:")) return null;
  if (value.startsWith("@")) {
    const parts = value.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return value.split("/")[0] || null;
}

function referencedRoots(sourceFiles: FetchedFile[]): Set<string> {
  const roots = new Set<string>();
  const pattern = /\b(?:from\s*|require\s*\(\s*|import\s*\(\s*|import\s+|export\s+[\s\S]{0,200}?from\s*)["']([^"']+)["']/g;
  for (const file of sourceFiles) {
    if (!JS_LIKE.test(file.path)) continue;
    for (const match of file.content.matchAll(pattern)) {
      const root = importRoot(match[1]);
      if (root) roots.add(root);
    }
  }
  return roots;
}

function parseManifest(content: string | null): { scripts: string; workspaces: boolean } | null {
  if (!content) return { scripts: "", workspaces: false };
  try {
    const data = JSON.parse(content) as {
      scripts?: Record<string, unknown>;
      workspaces?: unknown;
    };
    const scripts =
      data.scripts && typeof data.scripts === "object"
        ? Object.values(data.scripts)
            .filter((value): value is string => typeof value === "string")
            .join(" ")
        : "";
    const workspaces =
      Array.isArray(data.workspaces) ||
      (typeof data.workspaces === "object" && data.workspaces !== null);
    return { scripts, workspaces };
  } catch {
    return null;
  }
}

export function findUnusedDependencies(
  packages: DependencyPackage[],
  sourceFiles: FetchedFile[],
  options: {
    fullCoverage: boolean;
    eligibleFiles: number;
    analyzedFiles: number;
    manifestContent: string | null;
  },
): { suggestions: DependencyPackage[]; warning: string | null } {
  if (!options.fullCoverage) {
    return {
      suggestions: [],
      warning: `Unused-dependency detection was skipped because only ${options.analyzedFiles} of ${options.eligibleFiles} analyzable source files were analyzed.`,
    };
  }
  if (options.analyzedFiles === 0) {
    return { suggestions: [], warning: null };
  }

  const manifest = parseManifest(options.manifestContent);
  if (!manifest) {
    return {
      suggestions: [],
      warning: "Unused-dependency detection was skipped because package.json could not be parsed.",
    };
  }
  if (manifest.workspaces) {
    return {
      suggestions: [],
      warning: "Unused-dependency detection was skipped for workspace repositories.",
    };
  }

  const roots = referencedRoots(sourceFiles);
  const candidates = packages
    .filter(
      (pkg) =>
        pkg.ecosystem === "npm" &&
        pkg.direct &&
        pkg.runtime &&
        !pkg.dev &&
        !RUNTIME_LOADERS.has(pkg.name) &&
        !roots.has(pkg.name) &&
        !manifest.scripts.includes(pkg.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const suggestions = candidates.slice(0, MAX_UNUSED_FINDINGS);
  const warning =
    candidates.length > suggestions.length
      ? `Possibly unused dependency limit reached: ${candidates.length - suggestions.length} suggestions were omitted.`
      : null;

  return { suggestions, warning };
}
