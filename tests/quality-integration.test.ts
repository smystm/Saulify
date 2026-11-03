import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAstFiles } from "../lib/analyzer/ast";
import { analyzeArchitecture } from "../lib/analyzer/architecture";
import { analyzeCodeQuality } from "../lib/analyzer/quality";
import { dedupeFindings } from "../lib/analyzer";
import { makeQualityFinding } from "../lib/analyzer/quality/findings";
import { findingSchema, type Finding } from "../lib/reports/schema";

function qualityFinding(title: string, relatedFile = "src/other.ts") {
  return makeQualityFinding("src/a.ts", "export function f() { return 1; }", {
    ruleId: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    severity: "medium",
    confidence: "high",
    category: "maintainability",
    assessment: "measured",
    explanation: `${title} explanation.`,
    whyProblematic: "It may matter.",
    suggestedFix: "Fix it.",
    startLine: 1,
    endLine: 1,
    relatedLocations: [{ file: relatedFile, startLine: 1, endLine: 2 }],
  });
}

test("dedupe keeps quality findings that point at different related locations", () => {
  const first = qualityFinding("Duplicated code block", "src/other.ts");
  const second = qualityFinding("Duplicated code block", "src/third.ts");

  assert.equal(dedupeFindings([first, second]).length, 2);
  assert.equal(dedupeFindings([first, { ...first, id: "quality-copy" }]).length, 1);
});

test("dedupe orders quality findings before AI findings at the same severity and location", () => {
  const quality = qualityFinding("Measured quality issue");
  const ai: Finding = {
    ...quality,
    id: "ai-test",
    source: "ai",
    category: "architecture",
    title: "AI quality issue",
  };

  const deduped = dedupeFindings([ai, quality]);
  assert.equal(deduped[0].source, "quality");
  assert.equal(deduped[1].source, "ai");
});

test("quality and architecture stages produce schema-valid findings without AST cycle duplicates", () => {
  const files = [
    {
      path: "src/a.ts",
      content: [
        'import { b } from "./b";',
        "export function branchy(x: number) {",
        ...Array.from({ length: 15 }, (_, index) => `  if (x > ${index}) { x++; }`),
        "  return b + x;",
        "}",
      ].join("\n"),
    },
    {
      path: "src/b.ts",
      content: 'import { branchy } from "./a";\nexport const b = 1;',
    },
  ];
  const ast = analyzeAstFiles(files, { knownPaths: files.map((file) => file.path) });
  const quality = analyzeCodeQuality(files, ast.structures);
  const architecture = analyzeArchitecture({
    files,
    treeEntries: files.map((file) => ({ path: file.path, type: "blob", size: file.content.length })),
    treeTruncated: false,
    imports: ast.imports,
    analyzedPaths: ast.structures.map((structure) => structure.path),
    knownPaths: new Set(files.map((file) => file.path)),
    fullCoverage: true,
  });

  assert.equal(ast.findings.some((finding) => finding.title.includes("Circular import")), false);
  assert.ok(quality.findings.some((finding) => finding.title.includes("cyclomatic complexity")));
  assert.ok(architecture.findings.some((finding) => finding.title.includes("Circular module dependency")));

  const combined = dedupeFindings([...quality.findings, ...architecture.findings]);
  assert.ok(combined.every((finding) => finding.source === "quality"));
  assert.ok(combined.some((finding) => finding.category === "maintainability"));
  assert.ok(combined.some((finding) => finding.category === "architecture"));
  for (const finding of combined) {
    assert.doesNotThrow(() => findingSchema.parse(finding));
  }
});
