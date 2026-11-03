import { buildIssue, redactSensitiveText } from "@/lib/analyzer/static";
import type { Category, Confidence, Finding, Severity } from "@/lib/reports/schema";

export type AstFindingSpec = {
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  category: Category;
  explanation: string;
  whyProblematic: string;
  suggestedFix: string;
  startLine: number;
  endLine?: number;
  evidence?: string;
  evidenceStatus?: "verified" | "unverified";
};

export function hash(input: string): string {
  let value = 2166136261;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

export function lineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

export function lineAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(1, high + 1);
}

export function evidenceFrom(content: string, starts: number[], startLine: number, endLine: number): string {
  const start = starts[startLine - 1] ?? 0;
  const end = starts[endLine] ?? content.length;
  return redactSensitiveText(content.slice(start, end).trim()).slice(0, 1800);
}

export function makeAstFinding(filePath: string, content: string, spec: AstFindingSpec): Finding {
  const endLine = Math.max(spec.startLine, spec.endLine ?? spec.startLine);
  const starts = lineStarts(content);
  const evidence = spec.evidence
    ? redactSensitiveText(spec.evidence.trim()).slice(0, 1800)
    : evidenceFrom(content, starts, spec.startLine, endLine);
  const base = {
    title: spec.title,
    severity: spec.severity,
    confidence: spec.confidence,
    category: spec.category,
    explanation: spec.explanation,
    whyProblematic: spec.whyProblematic,
    suggestedFix: spec.suggestedFix,
    evidence,
    file: filePath,
    startLine: spec.startLine,
    endLine,
    source: "ast" as const,
    evidenceStatus: spec.evidenceStatus ?? ("verified" as const),
  };

  return {
    id: `ast-${hash(`${spec.ruleId}:${filePath}:${spec.startLine}:${endLine}`)}`,
    ...base,
    issue: buildIssue(base),
  };
}
