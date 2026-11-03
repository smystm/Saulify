import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAstFiles } from "../lib/analyzer/ast";
import { analyzeCodeQuality } from "../lib/analyzer/quality";
import { QUALITY_MAX_FINDINGS } from "../lib/analyzer/quality";
import type { FetchedFile } from "../lib/github/client";

function quality(files: FetchedFile[]) {
  const ast = analyzeAstFiles(files);
  return { ast, quality: analyzeCodeQuality(files, ast.structures) };
}

test("quality reports high cyclomatic complexity and deep nesting with measured evidence", () => {
  const nested = [
    "export function nested(x: number) {",
    "  if (x > 0) {",
    "    if (x > 1) {",
    "      if (x > 2) {",
    "        if (x > 3) {",
    "          if (x > 4) { return 1; }",
    "        }",
    "      }",
    "    }",
    "  }",
    "  return 0;",
    "}",
  ].join("\n");
  const branches = [
    "export function branchy(x: number) {",
    ...Array.from({ length: 15 }, (_, index) => `  if (x > ${index}) { x++; }`),
    "  return x;",
    "}",
  ].join("\n");

  const { quality: result } = quality([{ path: "src/metrics.ts", content: `${nested}\n${branches}` }]);
  const complexity = result.findings.find((finding) => finding.title.includes("cyclomatic complexity"));
  const nesting = result.findings.find((finding) => finding.title.includes("nesting") || finding.title.includes("Nested control"));

  assert.ok(complexity);
  assert.equal(complexity.source, "quality");
  assert.equal(complexity.category, "maintainability");
  assert.equal(complexity.assessment, "measured");
  assert.equal(complexity.confidence, "high");
  assert.match(complexity.explanation, /complexity of 16/);

  assert.ok(nesting);
  assert.match(nesting.explanation, /nesting depth of 5/);
});

test("quality reports oversized functions, files, long parameter lists, and boolean conditions", () => {
  const longFunction = [
    "export function longOne(a: number, b: number, c: number, d: number, e: number, f: number) {",
    ...Array.from({ length: 82 }, (_, index) => `  const value${index} = a + b + c + d + e + f;`),
    "  if (a && b && c && d && e && f) { return 1; }",
    "  return 0;",
    "}",
  ].join("\n");
  const padded = `${longFunction}\n${Array.from({ length: 460 }, () => "// padding").join("\n")}`;

  const { quality: result } = quality([{ path: "src/large.ts", content: padded }]);

  assert.ok(result.findings.some((finding) => finding.title.includes("Large function")));
  assert.ok(result.findings.some((finding) => finding.title.includes("Large source file")));
  assert.ok(result.findings.some((finding) => finding.title.includes("parameter list")));
  assert.ok(result.findings.some((finding) => finding.title.includes("boolean operators")));
});

test("quality flags nested ternaries and caps findings", () => {
  const file = {
    path: "src/ternary.ts",
    content: [
      "export function choose(a: number, b: number) {",
      "  return a ? (b ? 1 : 2) : 3;",
      "}",
      ...Array.from(
        { length: 12 },
        (_, index) =>
          `export function extra${index}(x: number) {\n${Array.from({ length: 6 }, () => "  if (x) { x++; }").join("\n")}\n  return x;\n}`,
      ),
    ].join("\n"),
  };

  const { quality: result } = quality([file]);

  assert.ok(result.findings.some((finding) => finding.title.includes("Nested ternary")));
  assert.ok(result.findings.length <= QUALITY_MAX_FINDINGS);
});

test("quality skips test paths and reports Python complexity metrics", () => {
  const python = [
    "def branchy(x):",
    ...Array.from({ length: 15 }, (_, index) => `    if x > ${index}:\n        x += 1`),
    "    return x",
  ].join("\n");

  const { quality: result } = quality([
    { path: "tests/example.ts", content: "const deadCode = 1;" },
    { path: "app/service.py", content: python },
  ]);

  assert.equal(result.findings.some((finding) => finding.file === "tests/example.ts"), false);
  assert.ok(
    result.findings.some(
      (finding) => finding.file === "app/service.py" && finding.title.includes("cyclomatic complexity"),
    ),
  );
});
