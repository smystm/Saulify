import type { FetchedFile } from "@/lib/github/client";
import type { Finding } from "@/lib/reports/schema";
import { makeAstFinding } from "./findings";
import type { AstImport, AstTimeBudget } from "./types";
import { budgetExpired } from "./types";

const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];
const MAX_UNRESOLVED_FINDINGS = 5;

export type ImportGraphInput = {
  path: string;
  imports: AstImport[];
};

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

function jsCandidates(fromPath: string, specifier: string): { base: string; candidates: string[] } {
  const clean = specifier.split(/[?#]/)[0];
  const base = normalizePath(`${dirname(fromPath)}/${clean}`);
  const candidates = new Set<string>([base]);

  if (!/\.[A-Za-z0-9]+$/.test(base)) {
    for (const extension of JS_EXTENSIONS) candidates.add(`${base}${extension}`);
  } else if (/\.(mjs|cjs|js|jsx)$/i.test(base)) {
    const stem = base.replace(/\.(mjs|cjs|js|jsx)$/i, "");
    for (const extension of [".ts", ".tsx", ".mts", ".cts", ".d.ts"]) candidates.add(`${stem}${extension}`);
  }

  for (const extension of JS_EXTENSIONS) candidates.add(`${base}/index${extension}`);
  return { base, candidates: [...candidates] };
}

function pythonCandidates(fromPath: string, python: NonNullable<AstImport["python"]>): string[] {
  if (python.level <= 0) return [];
  let base = dirname(fromPath);
  for (let level = 1; level < python.level; level++) base = dirname(base);

  const modulePaths = python.module
    ? [normalizePath(`${base}/${python.module.replace(/\./g, "/")}`)]
    : python.names.map((name) => normalizePath(`${base}/${name}`));

  const candidates: string[] = [];
  for (const modulePath of modulePaths) {
    candidates.push(`${modulePath}.py`, `${modulePath}/__init__.py`);
  }
  return candidates;
}

export function resolveImport(
  fromPath: string,
  item: AstImport,
  knownPaths: Set<string>,
): string | null {
  let candidates: string[] = [];
  if (item.language === "js") {
    if (!item.specifier.startsWith(".")) return null;
    candidates = jsCandidates(fromPath, item.specifier).candidates;
  } else if (item.python) {
    candidates = pythonCandidates(fromPath, item.python);
  }

  for (const candidate of candidates) {
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function addFinding(
  findings: Finding[],
  file: FetchedFile,
  item: AstImport,
  ruleId: string,
  spec: {
    title: string;
    severity: "low" | "medium";
    confidence: "medium" | "low";
    category: "correctness" | "maintainability";
    explanation: string;
    whyProblematic: string;
    suggestedFix: string;
    startLine: number;
  },
): void {
  findings.push(
    makeAstFinding(file.path, file.content, {
      ruleId,
      ...spec,
      endLine: item.endLine,
      evidence: item.text,
    }),
  );
}

export function analyzeImportGraph(
  files: FetchedFile[],
  inputs: ImportGraphInput[],
  knownPaths: Set<string> | undefined,
  budget: AstTimeBudget,
): Finding[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const analyzedPaths = new Set(inputs.map((input) => input.path));
  const resolutionPaths = new Set<string>([...analyzedPaths, ...(knownPaths ?? [])]);
  const findings: Finding[] = [];
  const unresolvedSeen = new Set<string>();

  for (const input of inputs) {
    if (budgetExpired(budget)) break;

    for (const item of input.imports) {
      const resolved = resolveImport(input.path, item, resolutionPaths);
      if (resolved) continue;

      if (
        item.language === "js" &&
        knownPaths &&
        item.specifier.startsWith(".") &&
        !item.specifier.includes("*")
      ) {
        const key = `${input.path}:${item.line}`;
        if (unresolvedSeen.has(key)) continue;
        unresolvedSeen.add(key);
        if (findings.length >= MAX_UNRESOLVED_FINDINGS) continue;
        const file = byPath.get(input.path);
        if (!file) continue;
        addFinding(findings, file, item, "unresolved-import", {
          title: "Relative import does not resolve to a repository file",
          severity: "low",
          confidence: "medium",
          category: "correctness",
          explanation: `The relative import "${item.specifier}" has no matching file or directory entry in the repository tree.`,
          whyProblematic:
            "A missing local module typically breaks the build or runtime path. Generated files and custom bundler aliases can produce the same shape without being broken.",
          suggestedFix:
            "Check the spelling and extension of the import, and confirm the target exists in the default branch before changing runtime code.",
          startLine: item.line,
        });
      }
    }
  }

  return findings;
}
