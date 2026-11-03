import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAstFiles } from "../lib/analyzer/ast";
import { analyzeJavaScriptFile } from "../lib/analyzer/ast/javascript";
import { createBudget } from "../lib/analyzer/ast/types";
import type { FetchedFile } from "../lib/github/client";

function analyze(file: FetchedFile, timeBudgetMs = 5_000) {
  return analyzeJavaScriptFile(file, createBudget(Date.now, timeBudgetMs));
}

test("JavaScript AST finds structural and declaration issues", () => {
  const result = analyze({
    path: "src/handler.ts",
    content: [
      'import { used, unused } from "./module";',
      "export function run(req: any) {",
      "  const unusedLocal = 1;",
      "  const value = req.query.value;",
      "  try { used(value); } catch (error) {}",
      "  return value;",
      '  console.log("dead");',
      "}",
      "const same = value === value;",
    ].join("\n"),
  });

  const titles = result.findings.map((finding) => finding.title);
  assert.equal(result.parsed, true);
  assert.ok(titles.some((title) => title.includes("Unused import")));
  assert.ok(titles.some((title) => title.includes("Unused local variable")));
  assert.ok(titles.some((title) => title.includes("silently")));
  assert.ok(titles.some((title) => title.includes("Unreachable")));
  assert.ok(titles.some((title) => title.includes("compared with itself")));
  assert.ok(result.findings.every((finding) => finding.source === "ast"));
  assert.ok(result.findings.every((finding) => finding.startLine !== null));
  assert.ok(result.findings.every((finding) => finding.evidence.length > 0));
});

test("TypeScript AST parses classes, generics, and JSX without executing code", () => {
  const result = analyze({
    path: "src/view.tsx",
    content: [
      'import React from "react";',
      "class Box<T> {",
      "  constructor(private value: T) {}",
      "  get(): T { return this.value; }",
      "}",
      "const box = new Box(1);",
      "export function View({ req }: { req: any }) {",
      "  return <div dangerouslySetInnerHTML={{ __html: req.query.html }} />;",
      "}",
      "export default box;",
    ].join("\n"),
  });

  assert.equal(result.parsed, true);
  assert.equal(result.findings.some((finding) => finding.title.includes("Unused import")), false);
  assert.ok(result.findings.some((finding) => finding.title.includes("raw HTML")));
});

test("JavaScript taint analysis connects request sources to command and HTML sinks", () => {
  const result = analyze({
    path: "src/run.ts",
    content: [
      'import { exec } from "child_process";',
      "export function handler(req: any) {",
      "  const command = req.query.command;",
      "  exec(command);",
      "  const html = req.body.html;",
      '  document.querySelector("#x")!.innerHTML = html;',
      "}",
    ].join("\n"),
  });

  const taintFindings = result.findings.filter((finding) => finding.evidenceStatus === "unverified");
  assert.ok(taintFindings.some((finding) => finding.title.includes("command execution sink")));
  assert.ok(taintFindings.some((finding) => finding.title.includes("HTML sink")));
  assert.ok(taintFindings.every((finding) => finding.confidence === "low" || finding.confidence === "medium"));
});

test("JavaScript taint analysis detects direct eval input", () => {
  const result = analyze({
    path: "src/eval.ts",
    content: "export function run(req: any) { return eval(req.body.expression); }",
  });

  assert.ok(result.findings.some((finding) => finding.title.includes("dynamic code execution")));
});

test("JavaScript syntax errors are skipped without findings or crashes", () => {
  const result = analyze({ path: "src/broken.ts", content: "const = ;" });
  assert.equal(result.parsed, false);
  assert.deepEqual(result.findings, []);
});

test("AST orchestration respects the finding cap and time budget", () => {
  const files = Array.from({ length: 8 }, (_, index) => ({
    path: `src/file${index}.ts`,
    content: `export function f${index}() { return 1; }\nconst unused${index} = 2;`,
  }));

  const capped = analyzeAstFiles(files, { maxFindings: 2 });
  assert.ok(capped.findings.length <= 2);

  const timedOut = analyzeAstFiles(files, { now: () => 0, timeBudgetMs: -1 });
  assert.equal(timedOut.timedOut, true);
  assert.deepEqual(timedOut.findings, []);
  assert.match(timedOut.warning ?? "", /time budget/);
});
