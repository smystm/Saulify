import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAstFiles } from "../lib/analyzer/ast";
import { analyzePythonFile } from "../lib/analyzer/ast/python";
import { createBudget } from "../lib/analyzer/ast/types";

function analyze(content: string, path = "app/handler.py") {
  return analyzePythonFile({ path, content }, createBudget(Date.now, 5_000));
}

test("Python AST finds imports, control flow, defaults, and unused locals", () => {
  const result = analyze(
    [
      "import os",
      "import sys",
      "from helpers import *",
      "",
      "def handler(request, items=[]):",
      '    value = request.args.get("value")',
      "    try:",
      "        os.system(value)",
      "    except:",
      "        pass",
      "    return value",
      '    print("dead")',
      "",
      "def other():",
      "    unused_local = 1",
    ].join("\n"),
  );

  const titles = result.findings.map((finding) => finding.title);
  assert.equal(result.parsed, true);
  assert.ok(titles.some((title) => title === "Unused import"));
  assert.ok(titles.some((title) => title.includes("Wildcard import")));
  assert.ok(titles.some((title) => title.includes("Mutable default")));
  assert.ok(titles.some((title) => title.includes("Bare except")));
  assert.ok(titles.some((title) => title.includes("Unreachable")));
  assert.ok(titles.some((title) => title.includes("Unused local variable")));
  assert.ok(titles.some((title) => title.includes("Python command execution sink")));
  assert.ok(result.findings.every((finding) => finding.source === "ast"));
});

test("Python taint analysis detects pickle and SQL sinks", () => {
  const pickleResult = analyze(
    [
      "import pickle",
      "",
      "def load(request):",
      "    blob = request.data",
      "    return pickle.loads(blob)",
    ].join("\n"),
    "app/load.py",
  );

  assert.ok(
    pickleResult.findings.some((finding) => finding.title.includes("pickle deserialization")),
  );

  const sqlResult = analyze(
    [
      "def run(request, cursor):",
      '    name = request.args["name"]',
      "    cursor.execute(\"SELECT * FROM users WHERE name = '%s'\" % name)",
    ].join("\n"),
    "app/sql.py",
  );

  assert.ok(sqlResult.findings.some((finding) => finding.title.includes("SQL statement")));
});

test("Python taint analysis stays quiet when no sink is reached", () => {
  const result = analyze(
    [
      "def clean(request):",
      '    value = request.args.get("value")',
      '    allowed = {"a", "b"}',
      "    if value in allowed:",
      "        return value",
      "    return None",
    ].join("\n"),
    "app/clean.py",
  );

  assert.equal(
    result.findings.some((finding) => finding.evidenceStatus === "unverified"),
    false,
  );
});

test("Python SQL checks ignore tainted bind parameters", () => {
  const result = analyze(
    [
      "def run(request, cursor):",
      '    name = request.args["name"]',
      '    cursor.execute("SELECT * FROM users WHERE name = %s", (name,))',
    ].join("\n"),
    "app/sql-safe.py",
  );

  assert.equal(result.findings.some((finding) => finding.title.includes("SQL statement")), false);
});

test("Python taint reaches shell-enabled subprocess lists and format calls", () => {
  const result = analyze(
    [
      "import subprocess",
      "",
      "def run(request):",
      '    command = request.args["cmd"]',
      '    subprocess.run(["sh", "-c", command], shell=True)',
      '    eval("{}".format(request.args["expr"]))',
    ].join("\n"),
    "app/subprocess.py",
  );

  const titles = result.findings.map((finding) => finding.title);
  assert.ok(titles.some((title) => title.includes("subprocess with shell enabled")));
  assert.ok(titles.some((title) => title.includes("dynamic Python code execution")));
});

test("Package __init__ files are not treated as unused re-exports", () => {
  const result = analyze("from .models import User\n", "app/__init__.py");
  assert.equal(result.parsed, true);
  assert.equal(result.findings.some((finding) => finding.title === "Unused import"), false);
});

test("Python syntax errors are skipped without crashes", () => {
  const result = analyze("def broken(:\n    pass\n", "app/broken.py");
  assert.equal(result.parsed, false);
  assert.deepEqual(result.findings, []);
});

test("Python files with shebangs and decorators parse normally", () => {
  const result = analyze(
    [
      "#!/usr/bin/env python3",
      "from flask import Flask",
      "",
      "app = Flask(__name__)",
      "",
      '@app.route("/")',
      "def index():",
      '    return "ok"',
    ].join("\n"),
    "app/main.py",
  );

  assert.equal(result.parsed, true);
  assert.equal(result.findings.some((finding) => finding.title === "Unused import"), false);
});

test("AST orchestration skips unparseable Python files and reports a warning", () => {
  const result = analyzeAstFiles(
    [{ path: "broken.py", content: "def broken(:\n    pass\n" }],
    { maxFindings: 5 },
  );
  assert.equal(result.parsedFiles, 0);
  assert.equal(result.skippedFiles, 1);
  assert.deepEqual(result.findings, []);
  assert.match(result.warning ?? "", /skipped/);
});
