import type { FetchedFile } from "@/lib/github/client";
import type { Confidence, Finding, Severity } from "@/lib/reports/schema";
import { analyzeImportGraph, type ImportGraphInput } from "./imports";
import { analyzeJavaScriptFile, isJavaScriptLike } from "./javascript";
import { analyzePythonFile, isPythonFile } from "./python";
import { createBudget, budgetExpired, type FileStructure } from "./types";

export const AST_MAX_FINDINGS = 10;
export const AST_TIME_BUDGET_MS = 4_000;
export const AST_MAX_FILE_CHARS = 100_000;

export type AstAnalysisOptions = {
  knownPaths?: Iterable<string>;
  maxFindings?: number;
  timeBudgetMs?: number;
  now?: () => number;
};

export type AstAnalysisResult = {
  findings: Finding[];
  structures: FileStructure[];
  imports: ImportGraphInput[];
  parsedFiles: number;
  skippedFiles: number;
  timedOut: boolean;
  warning: string | null;
};

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

function dedupeAstFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const result: Finding[] = [];
  for (const finding of findings) {
    const lineBucket = finding.startLine ? Math.floor((finding.startLine - 1) / 6) : 0;
    const key = `${finding.file ?? "repo"}|${finding.category}|${finding.title.toLowerCase()}|${lineBucket}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

export function analyzeAstFiles(
  files: FetchedFile[],
  options: AstAnalysisOptions = {},
): AstAnalysisResult {
  const now = options.now ?? Date.now;
  const budget = createBudget(now, options.timeBudgetMs ?? AST_TIME_BUDGET_MS);
  const perFile: Finding[] = [];
  const graphInputs: ImportGraphInput[] = [];
  const structures: FileStructure[] = [];
  let parsedFiles = 0;
  let skippedFiles = 0;
  let timedOut = false;

  for (const file of files) {
    if (!isJavaScriptLike(file.path) && !isPythonFile(file.path)) continue;
    if (file.content.length > AST_MAX_FILE_CHARS) {
      skippedFiles++;
      continue;
    }
    if (budgetExpired(budget)) {
      timedOut = true;
      break;
    }

    try {
      const result = isJavaScriptLike(file.path)
        ? analyzeJavaScriptFile(file, budget)
        : analyzePythonFile(file, budget);
      if (!result.parsed) {
        skippedFiles++;
        continue;
      }
      parsedFiles++;
      perFile.push(...result.findings);
      if (result.structure) structures.push(result.structure);
      const imports = result.imports;
      if (imports.length > 0) graphInputs.push({ path: file.path, imports });
    } catch {
      skippedFiles++;
    }
  }

  const graphFindings = timedOut
    ? []
    : analyzeImportGraph(
        files,
        graphInputs,
        options.knownPaths ? new Set(options.knownPaths) : undefined,
        budget,
      );

  const findings = dedupeAstFindings([...perFile, ...graphFindings])
    .sort(
      (a, b) =>
        SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] ||
        CONFIDENCE_WEIGHT[a.confidence] - CONFIDENCE_WEIGHT[b.confidence] ||
        (a.file ?? "").localeCompare(b.file ?? "") ||
        (a.startLine ?? 0) - (b.startLine ?? 0),
    )
    .slice(0, options.maxFindings ?? AST_MAX_FINDINGS);

  const notes: string[] = [];
  if (timedOut) {
    notes.push(
      "AST analysis reached its time budget; structural checks cover only the files processed before the limit.",
    );
  }
  if (skippedFiles > 0) {
    notes.push(
      `${skippedFiles} source file${skippedFiles === 1 ? "" : "s"} were skipped by AST analysis because the parser could not read them or they exceeded structural limits.`,
    );
  }

  return {
    findings,
    structures,
    imports: graphInputs,
    parsedFiles,
    skippedFiles,
    timedOut,
    warning: notes.length > 0 ? notes.join(" ") : null,
  };
}
