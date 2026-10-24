import type { TreeEntry } from "@/lib/github/client";

export const MAX_SELECTED_FILES = 20;
export const MAX_FILE_SIZE_BYTES = 100_000;

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".php",
  ".java",
  ".cs",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".sh",
  ".bash",
  ".yml",
  ".yaml",
]);

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "third_party",
  "third-party",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  "obj",
  "generated",
  "fixtures",
  "__snapshots__",
  "docs",
  "examples",
]);

const IGNORED_FILE_PATTERNS = [
  /\.min\.(js|css)$/i,
  /\.bundle\.js$/i,
  /\.map$/i,
  /\.d\.ts$/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.DS_Store$/i,
];

function segments(path: string): string[] {
  return path.split("/");
}

export function isAnalyzableFile(entry: TreeEntry): boolean {
  if (entry.type !== "blob" || entry.size <= 0 || entry.size > MAX_FILE_SIZE_BYTES) return false;
  if (entry.path.length > 320) return false;

  const parts = segments(entry.path);
  if (parts.some((part) => IGNORED_SEGMENTS.has(part.toLowerCase()))) return false;
  if (IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(entry.path))) return false;

  const dot = entry.path.lastIndexOf(".");
  if (dot < 0) return false;
  const extension = entry.path.slice(dot).toLowerCase();
  return SOURCE_EXTENSIONS.has(extension);
}

function scoreFile(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;

  if (/(^|\/)(src|app|lib|server|api|packages)\//.test(lower)) score += 40;
  if (/(auth|security|crypto|session|token|payment|upload|database|db|middleware|route|handler)/.test(lower)) {
    score += 24;
  }
  if (lower.startsWith(".github/workflows/")) score += 22;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(lower)) score += 12;
  if (/(^|\/)(test|tests|spec|__tests__)\//.test(lower)) score -= 14;
  if (/(config|settings|setup|index)\./.test(lower)) score += 5;
  if (segments(lower).length > 8) score -= 8;

  return score;
}

export type FileSelection = {
  selected: string[];
  skipped: number;
  eligible: number;
};

/**
 * Deterministic, quota-aware selection. Fetching is intentionally capped far
 * below what a repository can contain so one request cannot exhaust the server.
 */
export function selectFiles(entries: TreeEntry[], maxFiles = MAX_SELECTED_FILES): FileSelection {
  const analyzable = entries.filter(isAnalyzableFile);
  const sorted = [...analyzable].sort((a, b) => {
    const byScore = scoreFile(b.path) - scoreFile(a.path);
    return byScore !== 0 ? byScore : a.path.localeCompare(b.path);
  });
  const selected = sorted.slice(0, maxFiles).map((entry) => entry.path);

  return {
    selected,
    skipped: Math.max(0, entries.length - selected.length),
    eligible: analyzable.length,
  };
}
