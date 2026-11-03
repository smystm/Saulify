import type { FetchedFile } from "@/lib/github/client";
import type { Confidence, Finding, Severity } from "@/lib/reports/schema";
import type { FileStructure } from "@/lib/analyzer/ast/types";
import { findDuplicateFindings } from "./duplication";
import { collectMetricCandidates, type QualityCandidate } from "./metrics";

export const QUALITY_MAX_FINDINGS = 6;
export const QUALITY_TIME_BUDGET_MS = 1_500;

export type CodeQualityOptions = {
  timeBudgetMs?: number;
  maxFindings?: number;
  now?: () => number;
};

export type CodeQualityResult = {
  findings: Finding[];
  timedOut: boolean;
  warning: string | null;
};

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

export function analyzeCodeQuality(
  files: FetchedFile[],
  structures: FileStructure[],
  options: CodeQualityOptions = {},
): CodeQualityResult {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeBudgetMs ?? QUALITY_TIME_BUDGET_MS);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const candidates: QualityCandidate[] = [];

  for (const structure of structures) {
    if (now() > deadline) break;
    const file = byPath.get(structure.path);
    if (!file) continue;
    candidates.push(...collectMetricCandidates(file, structure));
  }

  const duplicates = findDuplicateFindings(
    files,
    new Set(structures.map((structure) => structure.path)),
    {
      now,
      timeBudgetMs: Math.max(0, deadline - now()),
      maxFindings: 3,
    },
  );
  for (const finding of duplicates.findings) candidates.push({ finding, score: 1 });

  const findings = candidates
    .sort(
      (a, b) =>
        SEVERITY_WEIGHT[a.finding.severity] - SEVERITY_WEIGHT[b.finding.severity] ||
        CONFIDENCE_WEIGHT[a.finding.confidence] - CONFIDENCE_WEIGHT[b.finding.confidence] ||
        b.score - a.score ||
        (a.finding.file ?? "").localeCompare(b.finding.file ?? "") ||
        (a.finding.startLine ?? 0) - (b.finding.startLine ?? 0),
    )
    .slice(0, options.maxFindings ?? QUALITY_MAX_FINDINGS)
    .map((candidate) => candidate.finding);

  const timedOut = now() > deadline || duplicates.timedOut;
  return {
    findings,
    timedOut,
    warning: timedOut
      ? "Code quality analysis reached its time budget; metrics and duplicate checks cover only the files processed before the limit."
      : null,
  };
}
