import { buildIssue, redactSensitiveText } from "@/lib/analyzer/static";
import type { Assessment, Finding } from "@/lib/reports/schema";
import { evidenceFrom, hash, lineStarts, type AstFindingSpec } from "@/lib/analyzer/ast/findings";

export type QualityRelatedLocation = {
  file: string;
  startLine: number;
  endLine: number;
};

export type QualityFindingSpec = AstFindingSpec & {
  assessment: Assessment;
  relatedLocations?: QualityRelatedLocation[];
};

export function makeQualityFinding(
  filePath: string,
  content: string,
  spec: QualityFindingSpec,
): Finding {
  const endLine = Math.max(spec.startLine, spec.endLine ?? spec.startLine);
  const evidence = spec.evidence
    ? redactSensitiveText(spec.evidence.trim()).slice(0, 2400)
    : evidenceFrom(content, lineStarts(content), spec.startLine, endLine);
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
    source: "quality" as const,
    evidenceStatus: spec.evidenceStatus ?? ("verified" as const),
    assessment: spec.assessment,
    relatedLocations: spec.relatedLocations,
  };

  return {
    id: `quality-${hash(`${spec.ruleId}:${filePath}:${spec.startLine}:${endLine}`)}`,
    ...base,
    issue: buildIssue(base),
  };
}
