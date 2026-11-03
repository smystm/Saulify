import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAstFiles } from "../lib/analyzer/ast";
import { analyzeCodeQuality } from "../lib/analyzer/quality";
import type { FetchedFile } from "../lib/github/client";

function duplicateFindings(files: FetchedFile[]) {
  const ast = analyzeAstFiles(files);
  return analyzeCodeQuality(files, ast.structures).findings.filter((finding) =>
    finding.title.includes("Duplicated code block"),
  );
}

const block = [
  "export function compute(values: number[]) {",
  "  const first = values[0] ?? 0;",
  "  const second = values[1] ?? 0;",
  "  const third = values[2] ?? 0;",
  "  const fourth = values[3] ?? 0;",
  "  const fifth = values[4] ?? 0;",
  "  const total = first + second + third + fourth + fifth;",
  "  const doubled = total * 2;",
  "  const adjusted = doubled - first;",
  "  const bounded = Math.max(0, adjusted);",
  "  return bounded + second;",
  "}",
].join("\n");

test("duplicate detection reports exact clones with related locations", () => {
  const findings = duplicateFindings([
    { path: "src/a.ts", content: block },
    { path: "src/b.ts", content: block },
  ]);

  const duplicate = findings[0];
  assert.ok(duplicate);
  assert.equal(duplicate.source, "quality");
  assert.equal(duplicate.category, "maintainability");
  assert.equal(duplicate.assessment, "measured");
  assert.equal(duplicate.confidence, "high");
  assert.ok(duplicate.relatedLocations && duplicate.relatedLocations.length === 1);
  assert.match(duplicate.evidence, /src\/a\.ts/);
  assert.match(duplicate.evidence, /src\/b\.ts/);
});

test("duplicate detection reports renamed clones with medium confidence", () => {
  const renamed = block
    .replaceAll("compute", "calculate")
    .replaceAll("values", "items")
    .replaceAll("first", "alpha")
    .replaceAll("second", "beta");

  const findings = duplicateFindings([
    { path: "src/a.ts", content: block },
    { path: "src/b.ts", content: renamed },
  ]);

  const duplicate = findings[0];
  assert.ok(duplicate);
  assert.equal(duplicate.confidence, "medium");
  assert.match(duplicate.explanation, /renamed/);
});

test("duplicate detection ignores short blocks, comments, and cross-language matches", () => {
  const shortBlock = block.split("\n").slice(0, 6).join("\n");
  const commented = block
    .split("\n")
    .map((line) => `  // note\n${line}`)
    .join("\n");

  const short = duplicateFindings([
    { path: "src/a.ts", content: shortBlock },
    { path: "src/b.ts", content: shortBlock },
  ]);
  assert.equal(short.length, 0);

  const crossLanguage = duplicateFindings([
    { path: "src/a.ts", content: block },
    { path: "src/a.py", content: block },
  ]);
  assert.equal(crossLanguage.length, 0);

  const comments = duplicateFindings([
    { path: "src/a.ts", content: block },
    { path: "src/b.ts", content: commented },
  ]);
  assert.ok(comments.length > 0);
});

test("duplicate findings stay within the quality finding cap", () => {
  const files = Array.from({ length: 8 }, (_, index) => ({
    path: `src/clone${index}.ts`,
    content: block,
  }));
  const findings = duplicateFindings(files);
  assert.ok(findings.length <= 3);
});
