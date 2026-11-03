import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";
import type { FetchedFile } from "@/lib/github/client";
import type { Finding, Severity } from "@/lib/reports/schema";
import { lineAt, lineStarts, makeAstFinding, type AstFindingSpec } from "./findings";
import { budgetExpired, type AstImport, type AstTimeBudget, type FileAstResult, type FileStructure, type FunctionMetrics } from "./types";

const PYTHON = /\.py$/i;
const MAX_NODES = 80_000;
const MAX_DEPTH = 320;
const MAX_FINDINGS_PER_FILE = 12;
const MAX_RULE_FINDINGS = 3;
const MAX_TAINT_FINDINGS = 4;

const EXIT_STATEMENTS = new Set([
  "ReturnStatement",
  "RaiseStatement",
  "BreakStatement",
  "ContinueStatement",
]);

const MUTABLE_LITERALS = new Set(["ArrayExpression", "DictionaryExpression", "SetExpression"]);
const MUTABLE_FACTORIES = new Set(["list", "dict", "set", "defaultdict", "OrderedDict", "Counter"]);
const SUBPROCESS_FUNCTIONS = new Set(["run", "call", "Popen", "check_output", "check_call"]);
const SQL_RECEIVER = /(?:^|\.)(?:cursor|conn|connection|db|session|engine|database)$/i;

const PY_SOURCE_PATTERNS = [
  /\b(?:request|req)\.(?:args|form|json|data|values|cookies|headers|files|body|query_params|META|FILES|COOKIES|GET|POST)\b/,
  /\b(?:request|req)\.get_json\b/,
  /\bsys\.argv\b/,
  /\binput\s*\(/,
];

type PyBinding = {
  name: string;
  line: number;
  endLine: number;
  text: string;
  noqa: boolean;
  skip: boolean;
};

type PyImportData = {
  imports: AstImport[];
  bindings: PyBinding[];
  ranges: Array<{ from: number; to: number }>;
  aliases: Map<string, string>;
  wildcards: Array<{ line: number; endLine: number; text: string; noqa: boolean }>;
};

type PyContext = {
  file: FetchedFile;
  content: string;
  starts: number[];
  budget: AstTimeBudget;
  findings: Finding[];
  scopes: Map<string, boolean>[];
  ruleCounts: Map<string, number>;
  nodes: number;
  complete: boolean;
  importData: PyImportData;
  variables: Array<{ name: string; line: number; endLine: number; text: string }>;
  hasDynamicEvaluation: boolean;
};

export function isPythonFile(path: string): boolean {
  return PYTHON.test(path);
}

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
  return children;
}

function nodeText(context: PyContext, node: SyntaxNode): string {
  return context.content.slice(node.from, node.to);
}

function lineOf(context: PyContext, offset: number): number {
  return lineAt(context.starts, offset);
}

function hasErrorNode(node: SyntaxNode, depth = 0): boolean {
  if (depth > 400) return true;
  if (node.name === "⚠") return true;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (hasErrorNode(child, depth + 1)) return true;
  }
  return false;
}

function addFinding(context: PyContext, ruleId: string, spec: Omit<AstFindingSpec, "ruleId">): void {
  if (context.findings.length >= MAX_FINDINGS_PER_FILE) return;
  if ((context.ruleCounts.get(ruleId) ?? 0) >= MAX_RULE_FINDINGS) return;
  context.ruleCounts.set(ruleId, (context.ruleCounts.get(ruleId) ?? 0) + 1);
  context.findings.push(makeAstFinding(context.file.path, context.content, { ruleId, ...spec }));
}

function isSourceText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ");
  return PY_SOURCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function lookupTaint(context: PyContext, name: string): boolean {
  for (let index = context.scopes.length - 1; index >= 0; index--) {
    const value = context.scopes[index].get(name);
    if (value !== undefined) return value;
  }
  return false;
}

function markTaint(context: PyContext, name: string, tainted: boolean): void {
  const scope = context.scopes[context.scopes.length - 1];
  if (scope) scope.set(name, tainted);
}

function isTainted(node: SyntaxNode, context: PyContext, depth = 0): boolean {
  if (depth > 200) return false;
  if (node.name === "VariableName") return lookupTaint(context, nodeText(context, node));
  if (node.name === "MemberExpression") {
    if (isSourceText(nodeText(context, node))) return true;
    return node.firstChild ? isTainted(node.firstChild, context, depth + 1) : false;
  }
  if (node.name === "CallExpression") {
    const callee = node.firstChild;
    const calleeText = callee ? nodeText(context, callee) : "";
    if (callee && isSourceText(calleeText)) return true;
    const calleeName = calleeText.split(".").pop() ?? "";
    if (calleeName === "input") return true;
    const argList = node.getChild("ArgList");
    if (
      argList &&
      (["str", "String", "decodeURIComponent", "format"].includes(calleeName) ||
        /(?:^|\.)(?:json\.loads|json\.load|base64\.b64decode)$/.test(calleeText))
    ) {
      return isTainted(argList, context, depth + 1);
    }
    return false;
  }
  if (
    node.name === "FormatString" ||
    node.name === "BinaryExpression" ||
    node.name === "BooleanExpression" ||
    node.name === "ComparisonExpression" ||
    node.name === "UnaryExpression" ||
    node.name === "AwaitExpression" ||
    node.name === "ParenthesizedExpression" ||
    node.name === "ConditionalExpression" ||
    node.name === "FormatReplacement" ||
    node.name === "ArrayExpression" ||
    node.name === "TupleExpression" ||
    node.name === "SetExpression" ||
    node.name === "DictionaryExpression" ||
    node.name === "ArgList"
  ) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (isTainted(child, context, depth + 1)) return true;
    }
  }
  return false;
}

function firstCallArgument(argList: SyntaxNode): SyntaxNode | null {
  for (let child = argList.firstChild; child; child = child.nextSibling) {
    if (child.name === "(" || child.name === ",") continue;
    return child;
  }
  return null;
}

function calibratedConfidence(context: PyContext, argument: SyntaxNode): "medium" | "low" {
  return isSourceText(nodeText(context, argument)) ? "medium" : "low";
}

function resolvedFunctionName(context: PyContext, functionText: string): string {
  const alias = context.importData.aliases;
  if (functionText.includes(".")) {
    const parts = functionText.split(".");
    const replacement = alias.get(parts[0]);
    if (replacement) return [replacement, ...parts.slice(1)].join(".");
    return functionText;
  }
  return alias.get(functionText) ?? functionText;
}

function addTaintFinding(
  context: PyContext,
  ruleId: string,
  node: SyntaxNode,
  spec: Omit<AstFindingSpec, "ruleId" | "startLine" | "endLine" | "confidence" | "evidenceStatus">,
  confidence: "medium" | "low",
): void {
  if ((context.ruleCounts.get("taint") ?? 0) >= MAX_TAINT_FINDINGS) return;
  context.ruleCounts.set("taint", (context.ruleCounts.get("taint") ?? 0) + 1);
  addFinding(context, ruleId, {
    ...spec,
    startLine: lineOf(context, node.from),
    endLine: lineOf(context, Math.max(node.from, node.to - 1)),
    confidence,
    evidenceStatus: "unverified",
  });
}

function inspectCall(context: PyContext, node: SyntaxNode): void {
  const callee = node.firstChild;
  const argList = node.getChild("ArgList");
  if (!callee || !argList) return;
  const firstArgument = firstCallArgument(argList);
  if (!firstArgument || !isTainted(firstArgument, context)) return;

  const functionText = resolvedFunctionName(context, nodeText(context, callee));
  const last = functionText.split(".").pop() ?? "";
  const argText = nodeText(context, argList);
  const confidence = calibratedConfidence(context, firstArgument);

  if (last === "eval" || last === "exec") {
    context.hasDynamicEvaluation = true;
    addTaintFinding(
      context,
      "taint-code-exec",
      node,
      {
        title: "Untrusted input may reach dynamic Python code execution",
        severity: "high",
        category: "security",
        explanation:
          "A value derived from request-like input reaches eval or exec. The data flow is inferred within this file and does not prove attacker control at runtime.",
        whyProblematic:
          "eval and exec compile strings into Python code. Attacker influence over that string can become arbitrary code execution.",
        suggestedFix:
          "Use explicit parsing, a fixed dispatch table, or a constrained data format such as JSON with schema validation.",
      },
      confidence,
    );
    return;
  }

  if (/(?:^|\.)os\.(?:system|popen)$/.test(functionText)) {
    addTaintFinding(
      context,
      "taint-command",
      node,
      {
        title: "Untrusted input may reach a Python command execution sink",
        severity: "high",
        category: "security",
        explanation:
          "A request-influenced value reaches os.system or os.popen. The analyzer cannot tell whether the value is validated before execution.",
        whyProblematic:
          "If the command string is attacker-influenced, an attacker may execute additional commands with the process's privileges.",
        suggestedFix:
          "Use subprocess with an argument list, a fixed executable, and shell disabled. Allow-list values that must come from users.",
      },
      confidence,
    );
    return;
  }

  if (SUBPROCESS_FUNCTIONS.has(last) && /shell\s*=\s*True/i.test(argText) && /(?:^|\.)subprocess\./.test(functionText)) {
    addTaintFinding(
      context,
      "taint-command",
      node,
      {
        title: "Untrusted input may reach a subprocess with shell enabled",
        severity: "high",
        category: "security",
        explanation:
          "A request-influenced value is passed to subprocess with shell=True. Shell parsing makes metacharacters executable when the value is not strictly validated.",
        whyProblematic:
          "Command injection can lead to arbitrary command execution with the application's privileges.",
        suggestedFix:
          "Pass an argument list, set shell=False, use a fixed executable, and validate dynamic values.",
      },
      confidence,
    );
    return;
  }

  if (/(?:^|\.)pickle\.(?:load|loads)$/.test(functionText)) {
    addTaintFinding(
      context,
      "taint-deserialization",
      node,
      {
        title: "Untrusted input may reach pickle deserialization",
        severity: "high",
        category: "security",
        explanation:
          "Request-influenced data reaches pickle. Pickle can execute code while loading, so authenticity must be established before deserialization.",
        whyProblematic:
          "A crafted pickle payload can execute arbitrary code before application-level validation is possible.",
        suggestedFix:
          "Prefer JSON or another data-only format. If pickle is required, verify an HMAC over the bytes with a server-side key before loading.",
      },
      confidence,
    );
    return;
  }

  if ((last === "execute" || last === "executemany") && SQL_RECEIVER.test(functionText.slice(0, Math.max(0, functionText.length - last.length - 1)))) {    addTaintFinding(
      context,
      "taint-sql",
      node,
      {
        title: "Untrusted input may reach a SQL statement",
        severity: "medium",
        category: "security",
        explanation:
          "A request-influenced value reaches a database execute call. The analyzer cannot tell whether the value is bound or concatenated into SQL text.",
        whyProblematic:
          "SQL text influenced by request data can change query structure and expose or alter stored data.",
        suggestedFix:
          "Use parameter placeholders and bound parameters. Never format request data into SQL text.",
      },
      confidence,
    );
    return;
  }

  if (last === "open" && /(?:^|\.)(?:io\.)?open$/.test(functionText)) {
    addTaintFinding(
      context,
      "taint-path",
      node,
      {
        title: "Untrusted input may control a file path",
        severity: "medium",
        category: "security",
        explanation:
          "A request-influenced value reaches open(). The analyzer cannot determine whether traversal is blocked elsewhere.",
        whyProblematic:
          "Unvalidated paths can read or overwrite files outside the intended directory, depending on process permissions.",
        suggestedFix:
          "Resolve the value against a fixed base directory, reject traversal, and verify the canonical path stays inside that directory.",
      },
      confidence,
    );
  }
}

function parseImportStatement(
  context: PyContext,
  node: SyntaxNode,
  data: PyImportData,
): void {
  const raw = nodeText(context, node);
  const flat = raw
    .replace(/\\\s*\n/g, " ")
    .replace(/#[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const startLine = lineOf(context, node.from);
  const endLine = lineOf(context, Math.max(node.from, node.to - 1));
  const noqa = /#\s*noqa\b/i.test(raw);
  data.ranges.push({ from: node.from, to: node.to });

  const fromMatch = /^from\s+([.]*)\s*([A-Za-z_][\w.]*)?\s*import\s+(.+)$/.exec(flat);
  if (fromMatch) {
    const level = fromMatch[1].length;
    const moduleName = fromMatch[2] ?? "";
    const rawNames = fromMatch[3];
    if (rawNames.trim() === "*") {
      data.wildcards.push({ line: startLine, endLine, text: raw, noqa });
      return;
    }
    const names: string[] = [];
    for (const part of rawNames.replace(/[()]/g, "").split(",")) {
      const match = /^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(part);
      if (!match) continue;
      const importedName = match[1];
      const alias = match[2] ?? importedName;
      names.push(importedName);
      data.aliases.set(alias, moduleName ? `${moduleName}.${importedName}` : importedName);
      data.bindings.push({
        name: alias,
        line: startLine,
        endLine,
        text: raw,
        noqa,
        skip: moduleName === "__future__",
      });
    }
    data.imports.push({
      specifier: `${".".repeat(level)}${moduleName}` || ".",
      line: startLine,
      endLine,
      text: raw,
      language: "py",
      python: { level, module: moduleName, names },
    });
    return;
  }

  const importMatch = /^import\s+(.+)$/.exec(flat);
  if (!importMatch) return;
  for (const part of importMatch[1].replace(/[()]/g, "").split(",")) {
    const match = /^\s*([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(part);
    if (!match) continue;
    const moduleName = match[1];
    const alias = match[2] ?? moduleName.split(".")[0];
    const root = moduleName.split(".")[0];
    data.aliases.set(alias, moduleName);
    data.aliases.set(root, root);
    data.bindings.push({
      name: alias,
      line: startLine,
      endLine,
      text: raw,
      noqa,
      skip: moduleName === "__future__",
    });
    data.imports.push({
      specifier: moduleName,
      line: startLine,
      endLine,
      text: raw,
      language: "py",
      python: { level: 0, module: moduleName, names: [moduleName.split(".").pop() ?? moduleName] },
    });
  }
}

function checkUnreachable(context: PyContext, node: SyntaxNode): void {
  const statements = childrenOf(node).filter((child) => child.name !== ":");
  const exitIndex = statements.findIndex((child) => EXIT_STATEMENTS.has(child.name));
  if (exitIndex < 0) return;
  const dead = statements.slice(exitIndex + 1).find((child) => child.name !== "PassStatement");
  if (!dead) return;

  addFinding(context, "unreachable", {
    title: "Unreachable code after an unconditional exit",
    severity: "low",
    confidence: "high",
    category: "correctness",
    explanation:
      "This statement follows a return, raise, break, or continue in the same block and cannot execute.",
    whyProblematic:
      "Dead statements often hide a refactoring mistake or a missing branch, and they mislead readers about what the code does.",
    suggestedFix: "Remove the dead statement, or move the exit so the intended logic is reachable and tested.",
    startLine: lineOf(context, dead.from),
    endLine: lineOf(context, Math.max(dead.from, dead.to - 1)),
  });
}

function checkMutableDefaults(context: PyContext, node: SyntaxNode): void {
  const params = node.getChild("ParamList");
  if (!params) return;
  const children = childrenOf(params);
  for (let index = 0; index < children.length; index++) {
    if (children[index].name !== "AssignOp") continue;
    const value = children[index + 1];
    if (!value) continue;
    const isMutable =
      MUTABLE_LITERALS.has(value.name) ||
      (value.name === "CallExpression" &&
        MUTABLE_FACTORIES.has(nodeText(context, value).split("(")[0].split(".").pop() ?? ""));
    if (!isMutable) continue;
    addFinding(context, "mutable-default", {
      title: "Mutable default argument is shared between calls",
      severity: "medium",
      confidence: "high",
      category: "correctness",
      explanation:
        "A list, dictionary, set, or mutable factory call is used as a parameter default. Python evaluates defaults once when the function is defined.",
      whyProblematic:
        "Calls mutate the same object across invocations, which can leak state between requests or tests and produce hard-to-reproduce behavior.",
      suggestedFix: "Use None as the default and create a new container inside the function when needed.",
      startLine: lineOf(context, node.from),
      endLine: lineOf(context, Math.max(node.from, node.to - 1)),
    });
    return;
  }
}

function checkBareExcept(context: PyContext, node: SyntaxNode): void {
  const children = childrenOf(node);
  for (let index = 0; index < children.length; index++) {
    if (children[index].name !== "except") continue;
    if (children[index + 1]?.name !== "Body") continue;
    addFinding(context, "bare-except", {
      title: "Bare except hides unexpected failures",
      severity: "medium",
      confidence: "high",
      category: "reliability",
      explanation:
        "A bare except catches every exception, including interrupts and programming errors that should normally propagate.",
      whyProblematic:
        "The application may continue in an invalid state because critical failures are treated the same as routine errors.",
      suggestedFix:
        "Catch the narrowest expected exception type and handle, log, or re-raise it deliberately.",
      startLine: lineOf(context, children[index].from),
      endLine: lineOf(context, Math.max(children[index].from, children[index].to - 1)),
    });
    return;
  }
}

function registerAssignment(context: PyContext, node: SyntaxNode, container: "module" | "class" | "function"): void {
  const children = childrenOf(node);
  let lastAssign = -1;
  for (let index = 0; index < children.length; index++) {
    if (children[index].name === "AssignOp") lastAssign = index;
  }
  if (lastAssign < 0) return;
  const right = children[lastAssign + 1];
  const names = children
    .slice(0, lastAssign)
    .filter((child) => child.name === "VariableName")
    .map((child) => nodeText(context, child));
  if (!right || names.length === 0) return;

  const tainted = isTainted(right, context);
  for (const name of names) markTaint(context, name, tainted);

  if (container === "function") {
    for (const name of names) {
      if (name.startsWith("_")) continue;
      context.variables.push({
        name,
        line: lineOf(context, node.from),
        endLine: lineOf(context, Math.max(node.from, node.to - 1)),
        text: nodeText(context, node),
      });
    }
  }
}

function walk(
  node: SyntaxNode,
  context: PyContext,
  container: "module" | "class" | "function",
  depth: number,
): void {
  if (!context.complete) return;
  context.nodes++;
  if (context.nodes > MAX_NODES || depth > MAX_DEPTH || budgetExpired(context.budget)) {
    context.complete = false;
    return;
  }

  if (node.name === "ImportStatement") {
    parseImportStatement(context, node, context.importData);
    return;
  }

  if (node.name === "FunctionDefinition" || node.name === "LambdaExpression") {
    if (node.name === "FunctionDefinition") checkMutableDefaults(context, node);
    context.scopes.push(new Map());
    for (let child = node.firstChild; child; child = child.nextSibling) {
      walk(child, context, "function", depth + 1);
    }
    context.scopes.pop();
    return;
  }

  if (node.name === "ClassDefinition") {
    context.scopes.push(new Map());
    for (let child = node.firstChild; child; child = child.nextSibling) {
      walk(child, context, "class", depth + 1);
    }
    context.scopes.pop();
    return;
  }

  if (node.name === "Body") checkUnreachable(context, node);
  if (node.name === "TryStatement") checkBareExcept(context, node);
  if (node.name === "AssignStatement") registerAssignment(context, node, container);
  if (node.name === "CallExpression") {
    const calleeText = node.firstChild ? nodeText(context, node.firstChild) : "";
    if (calleeText === "eval" || calleeText === "exec") context.hasDynamicEvaluation = true;
    inspectCall(context, node);
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    walk(child, context, container, depth + 1);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addImportFindings(context: PyContext): void {
  if (!context.complete) return;
  if (context.hasDynamicEvaluation) return;
  if (/\b(?:globals|locals)\s*\(/.test(context.content)) return;

  const isPackageInit = /(^|\/)__init__\.py$/i.test(context.file.path);

  let masked = context.content;
  for (const range of [...context.importData.ranges].sort((a, b) => b.from - a.from)) {
    masked = masked.slice(0, range.from) + " ".repeat(Math.max(0, range.to - range.from)) + masked.slice(range.to);
  }

  const seen = new Set<string>();
  for (const binding of context.importData.bindings) {
    if (isPackageInit) break;
    if (binding.skip || binding.noqa || binding.name.startsWith("_")) continue;
    const key = `${binding.name}:${binding.line}`;
    if (seen.has(key)) continue;
    const matches = masked.match(new RegExp(`\\b${escapeRegExp(binding.name)}\\b`, "g"));
    if (matches && matches.length > 0) continue;
    seen.add(key);
    addFinding(context, "unused-import", {
      title: "Unused import",
      severity: "low",
      confidence: "high",
      category: "maintainability",
      explanation: `The imported name "${binding.name}" is never referenced in this file.`,
      whyProblematic:
        "Unused imports add noise and can keep heavy modules or initialization work loaded for no reason.",
      suggestedFix: "Remove the unused import or use it in the intended code path.",
      startLine: binding.line,
      endLine: binding.endLine,
      evidence: binding.text,
    });
  }

  for (const wildcard of context.importData.wildcards) {
    if (wildcard.noqa || isPackageInit) continue;
    addFinding(context, "wildcard-import", {
      title: "Wildcard import obscures the module namespace",
      severity: "low",
      confidence: "high",
      category: "maintainability",
      explanation:
        "A wildcard import copies public names into this module without listing them, so dependencies and shadowing are hard to review.",
      whyProblematic:
        "Name collisions and accidental use of unrelated exports become difficult to trace, and tooling cannot reliably detect unused names.",
      suggestedFix: "Import the specific names used by this module.",
      startLine: wildcard.line,
      endLine: wildcard.endLine,
      evidence: wildcard.text,
    });
  }
}

function addUnusedVariableFindings(context: PyContext): void {
  if (!context.complete) return;
  if (context.hasDynamicEvaluation) return;
  if (/\b(?:globals|locals)\s*\(/.test(context.content)) return;

  const seen = new Set<string>();
  for (const variable of context.variables) {
    if (variable.name.startsWith("_")) continue;
    const key = `${variable.name}:${variable.line}`;
    if (seen.has(key)) continue;
    const matches = context.content.match(new RegExp(`\\b${escapeRegExp(variable.name)}\\b`, "g"));
    if (matches && matches.length > 1) continue;
    seen.add(key);
    addFinding(context, "unused-variable", {
      title: "Unused local variable",
      severity: "low",
      confidence: "medium",
      category: "maintainability",
      explanation: `The local variable "${variable.name}" is assigned but never read in this file.`,
      whyProblematic:
        "An unused local usually means an intended read was lost, or that work is paid for without a consumer.",
      suggestedFix: "Remove the assignment, or read the value where it was intended.",
      startLine: variable.line,
      endLine: variable.endLine,
      evidence: variable.text,
    });
  }
}

const PY_CONTROL = new Set([
  "IfStatement",
  "WhileStatement",
  "ForStatement",
  "WithStatement",
  "TryStatement",
  "MatchStatement",
]);

function pyFunctionName(node: SyntaxNode, context: PyContext): string {
  if (node.name === "LambdaExpression") return "<lambda>";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "VariableName") return nodeText(context, child);
  }
  return "<anonymous>";
}

function pyParameterCount(node: SyntaxNode, context: PyContext): number {
  const params = node.getChild("ParamList");
  if (!params) return 0;
  let count = 0;
  let first = true;
  for (let child = params.firstChild; child; child = child.nextSibling) {
    if (child.name !== "VariableName") continue;
    const name = nodeText(context, child);
    if (first && (name === "self" || name === "cls")) {
      first = false;
      continue;
    }
    first = false;
    count++;
  }
  return count;
}

function pyBooleanOperators(node: SyntaxNode): number {
  let count = 0;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "and" || child.name === "or") count++;
  }
  return count;
}

function pyTernaryDepth(node: SyntaxNode): number {
  if (node.name !== "ConditionalExpression") return 0;
  let depth = 0;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "ConditionalExpression") depth = Math.max(depth, pyTernaryDepth(child));
  }
  return 1 + depth;
}

function measurePyFunction(
  node: SyntaxNode,
  context: PyContext,
  kind: FunctionMetrics["kind"],
): FunctionMetrics {
  const startLine = lineOf(context, node.from);
  const endLine = lineOf(context, Math.max(node.from, node.to - 1));
  const metrics: FunctionMetrics = {
    name: pyFunctionName(node, context),
    kind,
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    complexity: 1,
    maxNesting: 0,
    parameterCount: pyParameterCount(node, context),
    maxBooleanOperators: 0,
    maxTernaryDepth: 0,
  };

  const visit = (current: SyntaxNode, nesting: number): void => {
    if (current !== node && (current.name === "FunctionDefinition" || current.name === "LambdaExpression")) {
      return;
    }

    if (current.name === "IfStatement") {
      let elifCount = 0;
      for (let child = current.firstChild; child; child = child.nextSibling) {
        if (child.name === "elif") elifCount++;
      }
      metrics.complexity += 1 + elifCount;
      const next = nesting + 1;
      metrics.maxNesting = Math.max(metrics.maxNesting, next);

      let afterBranch = false;
      for (let child = current.firstChild; child; child = child.nextSibling) {
        if (child.name === "elif" || child.name === "else") afterBranch = true;
        visit(child, afterBranch ? nesting : next);
      }
      return;
    }

    if (current.name === "TryStatement") {
      let excepts = 0;
      for (let child = current.firstChild; child; child = child.nextSibling) {
        if (child.name === "except") excepts++;
      }
      metrics.complexity += excepts;
      const next = nesting + 1;
      metrics.maxNesting = Math.max(metrics.maxNesting, next);
      let afterHandler = false;
      for (let child = current.firstChild; child; child = child.nextSibling) {
        if (child.name === "except" || child.name === "finally") afterHandler = true;
        visit(child, afterHandler ? nesting : next);
      }
      return;
    }

    if (PY_CONTROL.has(current.name)) {
      if (current.name === "WhileStatement" || current.name === "ForStatement") metrics.complexity++;
      if (current.name === "MatchStatement") {
        for (let child = current.firstChild; child; child = child.nextSibling) {
          if (child.name === "MatchClause") metrics.complexity++;
        }
      }
      const next = nesting + 1;
      metrics.maxNesting = Math.max(metrics.maxNesting, next);
      for (let child = current.firstChild; child; child = child.nextSibling) visit(child, next);
      return;
    }

    if (current.name === "ConditionalExpression") {
      metrics.complexity++;
      metrics.maxTernaryDepth = Math.max(metrics.maxTernaryDepth, pyTernaryDepth(current));
    }

    if (current.name === "BooleanExpression") {
      metrics.complexity += pyBooleanOperators(current);
      metrics.maxBooleanOperators = Math.max(metrics.maxBooleanOperators, pyBooleanOperators(current));
    }

    if (current.name.endsWith("ComprehensionExpression")) {
      for (let child = current.firstChild; child; child = child.nextSibling) {
        if (child.name === "for" || child.name === "if") metrics.complexity++;
      }
    }

    for (let child = current.firstChild; child; child = child.nextSibling) visit(child, nesting);
  };

  visit(node, 0);
  return metrics;
}

function collectPyStructure(context: PyContext, topNode: SyntaxNode): FileStructure | null {
  let nodes = 0;
  let complete = true;
  const functions: FunctionMetrics[] = [];

  const visit = (node: SyntaxNode, container: "module" | "class" | "function"): void => {
    if (!complete) return;
    nodes++;
    if (nodes > MAX_NODES || budgetExpired(context.budget)) {
      complete = false;
      return;
    }
    if (node.name === "FunctionDefinition" || node.name === "LambdaExpression") {
      const kind: FunctionMetrics["kind"] =
        node.name === "LambdaExpression" ? "lambda" : container === "class" ? "method" : "function";
      functions.push(measurePyFunction(node, context, kind));
    }
    const nextContainer =
      node.name === "ClassDefinition" ? "class" : node.name === "FunctionDefinition" ? "function" : container;
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child, nextContainer);
  };

  visit(topNode, "module");
  if (!complete) return null;

  return {
    path: context.file.path,
    language: "py",
    lineCount: context.file.content.split(/\r?\n/).length,
    functions,
    declarations: [],
    hasDynamicEvaluation: context.hasDynamicEvaluation,
  };
}

export function analyzePythonFile(file: FetchedFile, budget: AstTimeBudget): FileAstResult {
  let tree;
  try {
    tree = parser.parse(file.content);
  } catch {
    return { findings: [], imports: [], structure: null, parsed: false };
  }

  if (hasErrorNode(tree.topNode)) {
    return { findings: [], imports: [], structure: null, parsed: false };
  }

  const context: PyContext = {
    file,
    content: file.content,
    starts: lineStarts(file.content),
    budget,
    findings: [],
    scopes: [new Map()],
    ruleCounts: new Map(),
    nodes: 0,
    complete: true,
    importData: { imports: [], bindings: [], ranges: [], aliases: new Map(), wildcards: [] },
    variables: [],
    hasDynamicEvaluation: false,
  };

  walk(tree.topNode, context, "module", 0);
  addImportFindings(context);
  addUnusedVariableFindings(context);

  const structure = context.complete ? collectPyStructure(context, tree.topNode) : null;
  if (!structure) context.complete = false;

  const weight: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  context.findings.sort(
    (a, b) => weight[a.severity] - weight[b.severity] || (a.startLine ?? 0) - (b.startLine ?? 0),
  );

  return {
    findings: context.findings.slice(0, MAX_FINDINGS_PER_FILE),
    imports: context.complete ? context.importData.imports : [],
    structure,
    parsed: context.complete,
  };
}
