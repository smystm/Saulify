import type { TreeEntry } from "@/lib/github/client";
import { isSourcePath } from "@/lib/analyzer/select-files";

export const ROOT_SPRAWL_LIMIT = 12;
export const MAX_PATH_DEPTH = 8;
export const FRAGMENTED_DIR_LIMIT = 12;

export type StructureMetrics = {
  rootSourceFiles: string[];
  deepPaths: string[];
  topLevelDirs: number;
  fragmentedDirs: Array<{ directory: string; files: number; sample: string }>;
};

export function collectStructureMetrics(entries: TreeEntry[]): StructureMetrics {
  const sourceFiles = entries
    .filter((entry) => entry.type === "blob" && isSourcePath(entry.path))
    .map((entry) => entry.path)
    .sort();

  const rootSourceFiles = sourceFiles.filter((path) => !path.includes("/"));
  const deepPaths = sourceFiles.filter((path) => path.split("/").length > MAX_PATH_DEPTH);

  const byTopLevel = new Map<string, { files: number; sample: string }>();
  for (const path of sourceFiles) {
    if (!path.includes("/")) continue;
    const directory = path.slice(0, path.indexOf("/"));
    const current = byTopLevel.get(directory);
    if (current) current.files++;
    else byTopLevel.set(directory, { files: 1, sample: path });
  }

  const fragmentedDirs = [...byTopLevel.entries()]
    .filter(([, entry]) => entry.files <= 1)
    .map(([directory, entry]) => ({ directory, files: entry.files, sample: entry.sample }))
    .sort((a, b) => a.directory.localeCompare(b.directory));

  return {
    rootSourceFiles,
    deepPaths,
    topLevelDirs: byTopLevel.size,
    fragmentedDirs,
  };
}
