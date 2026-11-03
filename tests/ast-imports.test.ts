import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAstFiles } from "../lib/analyzer/ast";
import { analyzeStaticFiles } from "../lib/analyzer/static";
import { dedupeFindings } from "../lib/analyzer";
import { findingSchema } from "../lib/reports/schema";

test("AST import graph reports unresolved relative imports but leaves cycles to architecture analysis", () => {
  const files = [
    {
      path: "src/a.ts",
      content: 'import { b } from "./b";\nimport "./missing";\nexport const a = b;',
    },
    {
      path: "src/b.ts",
      content: 'import { a } from "./a";\nexport const b = a;',
    },
  ];

  const result = analyzeAstFiles(files, {
    knownPaths: ["src/a.ts", "src/b.ts"],
  });

  const titles = result.findings.map((finding) => finding.title);
  assert.equal(titles.includes("Circular import between analyzed modules"), false);
  assert.ok(titles.includes("Relative import does not resolve to a repository file"));
  assert.ok(result.findings.every((finding) => finding.source === "ast"));
});

test("AST import graph resolves files that exist in the repository tree", () => {
  const result = analyzeAstFiles(
    [{ path: "src/a.ts", content: 'import { util } from "./util";\nexport const value = util;' }],
    { knownPaths: ["src/a.ts", "src/util.ts"] },
  );

  assert.equal(
    result.findings.some((finding) => finding.title.includes("does not resolve")),
    false,
  );
});

test("AST import graph resolves Python relative imports without a module name", () => {
  const result = analyzeAstFiles(
    [
      { path: "app/a.py", content: "from . import b\n\na = b\n" },
      { path: "app/b.py", content: "from . import a\n\nb = a\n" },
    ],
    { knownPaths: ["app/a.py", "app/b.py"] },
  );

  assert.equal(
    result.findings.some((finding) => finding.title === "Circular import between analyzed modules"),
    false,
  );
});

test("Type-only TypeScript imports do not create runtime cycle findings", () => {
  const result = analyzeAstFiles(
    [
      {
        path: "src/a.ts",
        content: 'import type { B } from "./b";\nexport type A = B;',
      },
      {
        path: "src/b.ts",
        content: 'import type { A } from "./a";\nexport type B = A;',
      },
    ],
    { knownPaths: ["src/a.ts", "src/b.ts"] },
  );

  assert.equal(
    result.findings.some((finding) => finding.title === "Circular import between analyzed modules"),
    false,
  );
});

test("SQL sinks do not fire when tainted data is only a bound parameter", () => {
  const result = analyzeAstFiles([
    {
      path: "src/db.ts",
      content: [
        "export function find(pool: any, req: any) {",
        '  return pool.query("SELECT * FROM users WHERE id = $1", [req.body.id]);',
        "}",
      ].join("\n"),
    },
  ]);

  assert.equal(result.findings.some((finding) => finding.title.includes("SQL query")), false);
});

test("AST and static findings deduplicate without losing AST-only results", () => {
  const file = {
    path: "src/eval.ts",
    content: [
      "export function run(req: any) {",
      "  eval(req.body.expression);",
      "  return 1;",
      "  unreachable();",
      "}",
    ].join("\n"),
  };

  const staticFindings = analyzeStaticFiles([file]);
  const astFindings = analyzeAstFiles([file]).findings;
  const deduped = dedupeFindings([...staticFindings, ...astFindings]);

  assert.ok(staticFindings.length > 0);
  assert.ok(astFindings.some((finding) => finding.title.includes("Unreachable")));
  assert.equal(deduped.length, 2);
  assert.equal(deduped.filter((finding) => finding.title.includes("eval")).length, 1);
});

test("AST findings validate against the report schema", () => {
  const result = analyzeAstFiles([
    {
      path: "src/schema.ts",
      content: "export function f() { const unusedValue = 1; }",
    },
  ]);

  assert.ok(result.findings.length > 0);
  for (const finding of result.findings) {
    assert.doesNotThrow(() => findingSchema.parse(finding));
    assert.match(finding.issue.body, /Source: AST structural analysis/);
  }
});
