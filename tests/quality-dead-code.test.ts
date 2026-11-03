import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAstFiles } from "../lib/analyzer/ast";
import { analyzeCodeQuality } from "../lib/analyzer/quality";
import type { FetchedFile } from "../lib/github/client";

function findingsFor(files: FetchedFile[]) {
  const ast = analyzeAstFiles(files);
  return analyzeCodeQuality(files, ast.structures).findings;
}

test("quality reports non-exported top-level declarations with no references", () => {
  const findings = findingsFor([
    {
      path: "src/utils.ts",
      content: [
        "const unusedValue = 1;",
        "function unusedHelper() { return 2; }",
        "export const exportedValue = 3;",
        "export function usedHelper() { return 4; }",
      ].join("\n"),
    },
  ]);

  const dead = findings.filter((finding) => finding.title.includes("never referenced"));
  assert.equal(dead.length, 2);
  assert.ok(dead.every((finding) => finding.assessment === "measured"));
  assert.ok(dead.every((finding) => finding.confidence === "medium"));
  assert.equal(dead.some((finding) => finding.explanation.includes("exportedValue")), false);
  assert.equal(dead.some((finding) => finding.explanation.includes('"usedHelper"')), false);
});

test("dynamic evaluation disables dead top-level declaration checks", () => {
  const findings = findingsFor([
    {
      path: "src/dynamic.ts",
      content: [
        "const unusedValue = 1;",
        "export function run(value: string) {",
        "  return eval(value);",
        "}",
      ].join("\n"),
    },
  ]);

  assert.equal(findings.some((finding) => finding.title.includes("never referenced")), false);
});
