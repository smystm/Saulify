import test from "node:test";
import assert from "node:assert/strict";
import { findingSchema, reportSchema } from "../lib/reports/schema";
import { makeQualityFinding } from "../lib/analyzer/quality/findings";

function qualityFinding(related = true) {
  return makeQualityFinding("src/metrics.ts", "export function f() { return 1; }", {
    ruleId: "complexity",
    title: "High cyclomatic complexity",
    severity: "medium",
    confidence: "high",
    category: "maintainability",
    assessment: "measured",
    explanation: "f has a complexity of 16.",
    whyProblematic: "High complexity is harder to test.",
    suggestedFix: "Extract helpers.",
    startLine: 1,
    endLine: 1,
    relatedLocations: related
      ? [{ file: "src/helper.ts", startLine: 4, endLine: 8 }]
      : undefined,
  });
}

test("quality findings validate with assessment and related locations", () => {
  const finding = qualityFinding();
  assert.doesNotThrow(() => findingSchema.parse(finding));
  assert.equal(finding.source, "quality");
  assert.equal(finding.assessment, "measured");
  assert.match(finding.issue.body, /Assessment: \*\*measured signal\*\*/);
  assert.match(finding.issue.body, /## Related locations/);
  assert.match(finding.issue.body, /src\/helper\.ts:4-8/);
  assert.match(finding.issue.body, /Source: code quality and architecture analysis/);
});

test("findings without the optional quality fields remain valid", () => {
  const finding = qualityFinding(false);
  const legacy = {
    ...finding,
    assessment: undefined,
    relatedLocations: undefined,
  };
  assert.doesNotThrow(() => findingSchema.parse(legacy));
  assert.equal(findingSchema.parse(legacy).assessment, undefined);
});

test("finding schema rejects unknown assessments and sources", () => {
  const finding = qualityFinding();
  assert.equal(findingSchema.safeParse({ ...finding, assessment: "guess" }).success, false);
  assert.equal(findingSchema.safeParse({ ...finding, source: "quality-v2" }).success, false);
  assert.equal(
    findingSchema.safeParse({
      ...finding,
      relatedLocations: [{ file: "src/a.ts", startLine: 0, endLine: 1 }],
    }).success,
    false,
  );
});

test("report schema keeps version 1 compatibility with architecture findings", () => {
  const finding = qualityFinding();
  const report = {
    version: 1,
    id: "report-test",
    generatedAt: "2026-10-24T12:00:00.000Z",
    repo: {
      owner: "owner",
      name: "repo",
      fullName: "owner/repo",
      htmlUrl: "https://github.com/owner/repo",
      issuesUrl: "https://github.com/owner/repo/issues",
      description: null,
      defaultBranch: "main",
      stars: 0,
      forks: 0,
      sizeKb: 1,
      license: null,
      archived: false,
      pushedAt: null,
    },
    languages: [],
    mode: { ai: false, provider: "none", model: null, note: "Static analysis only." },
    stats: {
      treeEntries: 1,
      filesSelected: 1,
      filesAnalyzed: 1,
      filesSkipped: 0,
      treeTruncated: false,
      durationMs: 1,
    },
    warnings: [],
    summary: "Found 1 potential issue.",
    findings: [{ ...finding, category: "architecture" }],
  };

  assert.doesNotThrow(() => reportSchema.parse(report));
  assert.equal(reportSchema.safeParse({ ...report, version: 2 }).success, false);
});
