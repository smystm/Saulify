import type { TreeEntry } from "@/lib/github/client";
import { MAX_DEPENDENCY_FILES, MAX_DEPENDENCY_FILE_CHARS } from "@/lib/analyzer/dependencies/limits";

const NPM_LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;
const PYTHON_LOCKFILES = ["poetry.lock", "uv.lock", "pdm.lock", "Pipfile.lock"] as const;
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "vendor",
  "third_party",
  "third-party",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  "docs",
  "examples",
  "fixtures",
]);

export type DependencyFilePlan = {
  paths: string[];
  warnings: string[];
};

function rootBlob(entries: TreeEntry[], name: string): TreeEntry | undefined {
  return entries.find((entry) => entry.type === "blob" && entry.path === name);
}

function hasNestedManifest(entries: TreeEntry[]): boolean {
  const names = new Set<string>(["package.json", "requirements.txt", ...NPM_LOCKFILES, ...PYTHON_LOCKFILES]);
  return entries.some((entry) => {
    if (entry.type !== "blob" || !entry.path.includes("/")) return false;
    const parts = entry.path.split("/");
    if (parts.slice(0, -1).some((part) => IGNORED_SEGMENTS.has(part.toLowerCase()))) return false;
    return names.has(parts[parts.length - 1]);
  });
}

export function planDependencyFiles(entries: TreeEntry[]): DependencyFilePlan {
  const warnings: string[] = [];
  const paths: string[] = [];
  const add = (path: string) => {
    if (paths.includes(path) || paths.length >= MAX_DEPENDENCY_FILES) return;
    const file = rootBlob(entries, path);
    if (!file) return;
    if (file.size > MAX_DEPENDENCY_FILE_CHARS) {
      warnings.push(`${path} was skipped because it exceeds the dependency file size limit.`);
      return;
    }
    paths.push(path);
  };

  if (hasNestedManifest(entries)) {
    warnings.push("Dependency analysis covers root-level manifests only; nested manifests were not analyzed.");
  }

  const npmManifest = rootBlob(entries, "package.json");
  const npmLocks = NPM_LOCKFILES.filter((name) => rootBlob(entries, name));
  const chosenNpmLock = npmLocks[0] ?? null;
  if (npmLocks.length > 1) {
    warnings.push(`Multiple npm lockfiles were found; ${chosenNpmLock} is used for resolved versions.`);
  }

  const pythonLocks = PYTHON_LOCKFILES.filter((name) => rootBlob(entries, name));
  const chosenPythonLock = pythonLocks[0] ?? null;
  if (pythonLocks.length > 1) {
    warnings.push(`Multiple Python lockfiles were found; ${chosenPythonLock} is used for resolved versions.`);
  }

  if (npmManifest) add("package.json");
  if (chosenNpmLock) add(chosenNpmLock);
  if (chosenPythonLock) add(chosenPythonLock);
  if (rootBlob(entries, "requirements.txt")) add("requirements.txt");

  return { paths, warnings };
}
