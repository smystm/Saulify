import ts from "typescript";
import type { FetchedFile } from "@/lib/github/client";
import type { Finding, Severity } from "@/lib/reports/schema";
import { makeAstFinding, type AstFindingSpec } from "./findings";
import { budgetExpired, type AstImport, type AstTimeBudget, type DeclarationMetric, type FileAstResult, type FileStructure, type FunctionMetrics } from "./types";

const JS_LIKE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;
const MAX_NODES = 80_000;
const MAX_FINDINGS_PER_FILE = 12;
const MAX_RULE_FINDINGS = 3;
const MAX_TAINT_FINDINGS = 4;

const CHILD_PROCESS_FUNCTIONS = new Set(["exec", "execSync", "spawn", "spawnSync"]);
const FS_FUNCTIONS = new Set([
  "readFile",
  "readFileSync",
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createReadStream",
  "createWriteStream",
  "open",
  "openSync",
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
  "stat",
  "statSync",
  "access",
  "accessSync",
  "copyFile",
  "copyFileSync",
]);
const SQL_FUNCTIONS = new Set(["query", "execute", "raw", "executemany", "$queryRawUnsafe"]);
const SQL_RECEIVER = /(?:^|\.)(?:db|database|pool|client|conn|connection|sequelize|knex|prisma)$/i;

const SOURCE_PATTERNS = [
  /\b(?:req|request)\.(?:body|query|params|cookies|headers|files|file|args|form|json|data|values|GET|POST)\b/,
  /\b(?:req|request)\.(?:get|header|param|query|body|get_json)\s*\(/,
  /\.searchParams(?:\.get\s*\(|\b)/,
  /\b(?:location|document\.location|window\.location)\.(?:search|hash|href)\b/,
  /\b(?:event|evt)\.(?:body|queryStringParameters|pathParameters|headers)\b/,
  /\bprocess\.argv\b/,
];

type ImportBinding = {
  name: string;
  line: number;
  endLine: number;
  text: string;
};

type LocalVariable = {
  name: string;
  line: number;
  endLine: number;
  text: string;
};

type JsContext = {
  file: FetchedFile;
  sourceFile: ts.SourceFile;
  budget: AstTimeBudget;
  findings: Finding[];
  imports: AstImport[];
  importBindings: ImportBinding[];
  variables: LocalVariable[];
  refCounts: Map<string, number>;
  scopes: Map<string, boolean>[];
  specialImports: Map<string, string>;
  ruleCounts: Map<string, number>;
  nodes: number;
  hasEval: boolean;
  hasDynamicImport: boolean;
  hasDynamicRequire: boolean;
  hasJsx: boolean;
  complete: boolean;
};

export function isJavaScriptLike(path: string): boolean {
  return JS_LIKE.test(path);
}

function scriptKind(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

function moduleKind(specifier: string): string | null {
  if (specifier === "child_process" || specifier === "node:child_process") return "child_process";
  if (specifier === "fs" || specifier === "node:fs") return "fs";
  return null;
}

function lineOf(context: JsContext, position: number): number {
  return context.sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function addFinding(context: JsContext, ruleId: string, spec: Omit<AstFindingSpec, "ruleId">): void {
  if (context.findings.length >= MAX_FINDINGS_PER_FILE) return;
  if ((context.ruleCounts.get(ruleId) ?? 0) >= MAX_RULE_FINDINGS) return;
  context.ruleCounts.set(ruleId, (context.ruleCounts.get(ruleId) ?? 0) + 1);
  context.findings.push(makeAstFinding(context.file.path, context.file.content, { ruleId, ...spec }));
}

function textOf(context: JsContext, node: ts.Node): string {
  return node.getText(context.sourceFile);
}

function isSourceText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ");
  return SOURCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isIdentifierReference(node: ts.Identifier, parent: ts.Node | null): boolean {
  if (!parent) return true;
  if (ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (
    (ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isTypeParameterDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (
    (ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (ts.isJsxAttribute(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (ts.isExportSpecifier(parent) && parent.propertyName === node) return false;
  return true;
}

function lookupTaint(context: JsContext, name: string): boolean {
  for (let index = context.scopes.length - 1; index >= 0; index--) {
    const value = context.scopes[index].get(name);
    if (value !== undefined) return value;
  }
  return false;
}

function markTaint(context: JsContext, name: string, tainted: boolean): void {
  const scope = context.scopes[context.scopes.length - 1];
  if (scope) scope.set(name, tainted);
}

function isTainted(node: ts.Node, context: JsContext, depth = 0): boolean {
  if (depth > 200) return false;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return false;
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isIdentifier(node)) return lookupTaint(context, node.text);
  if (isSourceText(textOf(context, node))) return true;

  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return isTainted(node.expression, context, depth + 1);
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return isTainted(node.expression, context, depth + 1);
  }
  if (ts.isTypeAssertionExpression(node)) return isTainted(node.expression, context, depth + 1);
  if (ts.isAwaitExpression(node)) return isTainted(node.expression, context, depth + 1);
  if (ts.isConditionalExpression(node)) {
    return isTainted(node.whenTrue, context, depth + 1) || isTainted(node.whenFalse, context, depth + 1);
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return false;
    return isTainted(node.left, context, depth + 1) || isTainted(node.right, context, depth + 1);
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.some((span) => isTainted(span.expression, context, depth + 1));
  }
  if (ts.isCallExpression(node)) {
    const callee = textOf(context, node.expression);
    if (isSourceText(callee)) return true;
    if (ts.isPropertyAccessExpression(node.expression) && isTainted(node.expression.expression, context, depth + 1)) {
      return true;
    }
    if (
      callee === "JSON.parse" &&
      node.arguments.some((argument) => isTainted(argument, context, depth + 1))
    ) {
      return true;
    }
    const last = callee.split(".").pop();
    return (
      ["String", "decodeURIComponent", "decodeURI", "atob"].includes(last ?? "") &&
      node.arguments.some((argument) => isTainted(argument, context, depth + 1))
    );
  }
  return false;
}

function calibratedConfidence(context: JsContext, taintedArgs: ts.Node[]): "medium" | "low" {
  return taintedArgs.some((argument) => isSourceText(textOf(context, argument))) ? "medium" : "low";
}

function addTaintFinding(
  context: JsContext,
  ruleId: string,
  node: ts.Node,
  spec: Omit<AstFindingSpec, "ruleId" | "startLine" | "endLine" | "confidence" | "evidenceStatus">,
  confidence: "medium" | "low",
): void {
  if ((context.ruleCounts.get("taint") ?? 0) >= MAX_TAINT_FINDINGS) return;
  context.ruleCounts.set("taint", (context.ruleCounts.get("taint") ?? 0) + 1);
  addFinding(context, ruleId, {
    ...spec,
    startLine: lineOf(context, node.getStart(context.sourceFile)),
    endLine: lineOf(context, node.getEnd()),
    confidence,
    evidenceStatus: "unverified",
  });
}

function importedModule(context: JsContext, calleeText: string): string | null {
  const root = calleeText.split(".")[0];
  return context.specialImports.get(calleeText) ?? context.specialImports.get(root) ?? null;
}

function inspectCall(context: JsContext, node: ts.CallExpression | ts.NewExpression): void {
  const callee = node.expression;
  const calleeText = textOf(context, callee);
  const last = calleeText.split(".").pop() ?? "";
  const args = node.arguments ? Array.from(node.arguments) : [];
  const taintedArgs = args.filter((argument) => isTainted(argument, context));
  if (taintedArgs.length === 0) return;

  if (ts.isNewExpression(node) && last === "Function") {
    addTaintFinding(
      context,
      "taint-code-exec",
      node,
      {
        title: "Untrusted input may reach dynamic code construction",
        severity: "high",
        category: "security",
        explanation:
          "A value influenced by request-like input reaches the Function constructor. Static taint tracking links the source and sink in this file, but does not prove the input is attacker-controlled at runtime.",
        whyProblematic:
          "If the string can be influenced by an attacker, it becomes arbitrary code execution in the application's process.",
        suggestedFix:
          "Replace string compilation with explicit control flow or a fixed dispatch map. Sanitize and allow-list any value that must be used.",
      },
      calibratedConfidence(context, taintedArgs),
    );
    return;
  }

  if (last === "eval") {
    addTaintFinding(
      context,
      "taint-code-exec",
      node,
      {
        title: "Untrusted input may reach dynamic code execution",
        severity: "high",
        category: "security",
        explanation:
          "A value derived from request-like input reaches eval. The flow is tracked within this file and is a review candidate, not a confirmed exploit.",
        whyProblematic:
          "Attacker-influenced eval input allows arbitrary code execution and bypasses normal module boundaries.",
        suggestedFix:
          "Remove eval. Parse data explicitly, use a fixed lookup table, or apply a constrained expression parser.",
      },
      calibratedConfidence(context, taintedArgs),
    );
    return;
  }

  const importSource = importedModule(context, calleeText);
  const root = calleeText.split(".")[0];
  if (
    CHILD_PROCESS_FUNCTIONS.has(last) &&
    (importSource === "child_process" || root === "child_process")
  ) {
    addTaintFinding(
      context,
      "taint-command",
      node,
      {
        title: "Untrusted input may reach a command execution sink",
        severity: "high",
        category: "security",
        explanation:
          "A request-influenced value reaches a child-process API. The data flow is inferred from assignments in this file and may cross validation or escaping that the analyzer cannot see.",
        whyProblematic:
          "If the value is not strictly validated, an attacker may execute additional commands with the application's privileges.",
        suggestedFix:
          "Use execFile or spawn with a fixed executable and an argument array. Validate values against an allow-list and never enable a shell.",
      },
      calibratedConfidence(context, taintedArgs),
    );
    return;
  }

  if (FS_FUNCTIONS.has(last) && (importSource === "fs" || root === "fs") && args[0] && isTainted(args[0], context)) {
    addTaintFinding(
      context,
      "taint-path",
      node,
      {
        title: "Untrusted input may control a filesystem path",
        severity: "medium",
        category: "security",
        explanation:
          "A request-influenced value reaches a filesystem API. The analyzer cannot determine whether path traversal is blocked elsewhere.",
        whyProblematic:
          "Unvalidated paths can read, overwrite, or delete files outside the intended directory, depending on process permissions.",
        suggestedFix:
          "Resolve the value against a fixed base directory, reject traversal, and confirm the canonical path remains inside that directory.",
      },
      calibratedConfidence(context, taintedArgs),
    );
    return;
  }

  if (last === "insertAdjacentHTML" && args[1] && isTainted(args[1], context)) {
    addTaintFinding(
      context,
      "taint-html",
      node,
      {
        title: "Untrusted input may reach an HTML sink",
        severity: "high",
        category: "security",
        explanation:
          "A request-influenced value reaches insertAdjacentHTML. This is a potential cross-site scripting path, not proof that the value can be exploited.",
        whyProblematic:
          "HTML parsed from attacker-influenced input can execute script in the page's origin.",
        suggestedFix:
          "Build DOM nodes with textContent, or sanitize the HTML with a maintained allow-list sanitizer before insertion.",
      },
      calibratedConfidence(context, taintedArgs),
    );
    return;
  }

  if (
    last === "redirect" &&
    args[0] &&
    isTainted(args[0], context) &&
    /(?:^|\.)(?:res|response|reply)$/.test(
      calleeText.slice(0, Math.max(0, calleeText.length - last.length - 1)),
    )
  ) {
    addTaintFinding(
      context,
      "taint-redirect",
      node,
      {
        title: "Untrusted input may control a redirect target",
        severity: "medium",
        category: "security",
        explanation:
          "A request-influenced value reaches a redirect API. The analyzer cannot confirm whether the destination is checked against an allow-list.",
        whyProblematic:
          "Unvalidated redirect targets can send users to attacker-controlled sites from a trusted link.",
        suggestedFix:
          "Redirect only to a fixed allow-list of internal paths or verified origins.",
      },
      calibratedConfidence(context, taintedArgs),
    );
    return;
  }

  if (SQL_FUNCTIONS.has(last) && args[0] && isTainted(args[0], context)) {
    const receiver = calleeText.slice(0, Math.max(0, calleeText.length - last.length - 1));
    if (SQL_RECEIVER.test(receiver)) {
      addTaintFinding(
        context,
        "taint-sql",
        node,
        {
          title: "Untrusted input may reach a SQL query",
          severity: "medium",
          category: "security",
          explanation:
            "A request-influenced value is passed into a database query call. The analyzer cannot tell whether the value is bound as a parameter or concatenated as SQL text.",
          whyProblematic:
            "SQL text influenced by request data can change query structure and expose or modify stored data.",
          suggestedFix:
            "Use parameter placeholders or ORM bound parameters. Never interpolate request data into SQL text.",
        },
        calibratedConfidence(context, taintedArgs),
      );
    }
  }
}

function isConstantExit(node: ts.Statement): boolean {
  return (
    ts.isReturnStatement(node) ||
    ts.isThrowStatement(node) ||
    ts.isBreakStatement(node) ||
    ts.isContinueStatement(node)
  );
}

function isTypeOnlyStatement(node: ts.Statement): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEmptyStatement(node)
  );
}

function checkUnreachable(context: JsContext, statements: readonly ts.Statement[]): void {
  const exitIndex = statements.findIndex(isConstantExit);
  if (exitIndex < 0) return;
  const dead = statements.slice(exitIndex + 1).find((statement) => !isTypeOnlyStatement(statement));
  if (!dead) return;

  addFinding(context, "unreachable", {
    title: "Unreachable code after an unconditional exit",
    severity: "low",
    confidence: "high",
    category: "correctness",
    explanation:
      "This statement follows a return, throw, break, or continue in the same block and cannot execute.",
    whyProblematic:
      "Dead statements often hide a refactoring mistake or a missing branch, and they mislead readers about what the code does.",
    suggestedFix:
      "Remove the dead statement, or move the exit so the intended logic is reachable and tested.",
    startLine: lineOf(context, dead.getStart(context.sourceFile)),
    endLine: lineOf(context, dead.getEnd()),
  });
}

function checkSelfComparison(context: JsContext, node: ts.BinaryExpression): void {
  const operator = node.operatorToken.getText(context.sourceFile);
  if (operator === "===" || operator === "==") {
    if (ts.isIdentifier(node.left) && ts.isIdentifier(node.right) && node.left.text === node.right.text) {
      addFinding(context, "self-comparison", {
        title: "Value is compared with itself",
        severity: "low",
        confidence: "medium",
        category: "correctness",
        explanation: "Both sides of this comparison are the same identifier, so the result is normally constant.",
        whyProblematic:
          "A self-comparison usually indicates a copy-paste mistake and can make a validation branch unreachable.",
        suggestedFix: "Compare against the intended second value and add a test covering both branches.",
        startLine: lineOf(context, node.getStart(context.sourceFile)),
        endLine: lineOf(context, node.getEnd()),
      });
    }
  }
  if (operator === "=" && ts.isIdentifier(node.left) && ts.isIdentifier(node.right) && node.left.text === node.right.text) {
    addFinding(context, "self-assignment", {
      title: "Value is assigned to itself",
      severity: "low",
      confidence: "medium",
      category: "maintainability",
      explanation: "This assignment writes a value back to the same identifier without changing it.",
      whyProblematic:
        "Self-assignment is usually a leftover edit and may hide a missing update to another field or variable.",
      suggestedFix: "Assign the intended source value, or remove the statement.",
      startLine: lineOf(context, node.getStart(context.sourceFile)),
      endLine: lineOf(context, node.getEnd()),
    });
  }
}

function collectImport(context: JsContext, node: ts.ImportDeclaration): void {
  if (!ts.isStringLiteralLike(node.moduleSpecifier)) return;
  const specifier = node.moduleSpecifier.text;
  const startLine = lineOf(context, node.getStart(context.sourceFile));
  const endLine = lineOf(context, node.getEnd());
  const text = textOf(context, node);
  context.imports.push({
    specifier,
    line: startLine,
    endLine,
    text,
    language: "js",
    moduleKind: "esm",
    typeOnly: node.importClause?.isTypeOnly ?? false,
  });

  const addBinding = (name: ts.Identifier, kind: string | null) => {
    context.importBindings.push({
      name: name.text,
      line: startLine,
      endLine,
      text,
    });
    if (kind) context.specialImports.set(name.text, kind);
  };

  const clause = node.importClause;
  if (!clause) return;
  const kind = moduleKind(specifier);
  if (clause.name) addBinding(clause.name, kind);
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      addBinding(clause.namedBindings.name, kind);
    } else {
      for (const element of clause.namedBindings.elements) addBinding(element.name, kind);
    }
  }
}

function collectRequire(context: JsContext, node: ts.CallExpression): void {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "require") return;
  if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
    context.hasDynamicRequire = true;
    return;
  }
  const specifier = node.arguments[0].text;
  context.imports.push({
    specifier,
    line: lineOf(context, node.getStart(context.sourceFile)),
    endLine: lineOf(context, node.getEnd()),
    text: textOf(context, node),
    language: "js",
    moduleKind: "cjs",
  });
}

function walk(node: ts.Node, parent: ts.Node | null, functionDepth: number, context: JsContext): void {
  if (!context.complete) return;
  context.nodes++;
  if (context.nodes > MAX_NODES || budgetExpired(context.budget)) {
    context.complete = false;
    return;
  }

  if (ts.isImportDeclaration(node)) {
    collectImport(context, node);
    return;
  }
  if (ts.isCallExpression(node)) collectRequire(context, node);

  if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
    context.imports.push({
      specifier: node.moduleSpecifier.text,
      line: lineOf(context, node.getStart(context.sourceFile)),
      endLine: lineOf(context, node.getEnd()),
      text: textOf(context, node),
      language: "js",
      moduleKind: "esm",
      typeOnly: node.isTypeOnly,
    });
  }

  if (ts.isIdentifier(node) && isIdentifierReference(node, parent)) {
    context.refCounts.set(node.text, (context.refCounts.get(node.text) ?? 0) + 1);
  }

  if (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node) ||
    ts.isJsxOpeningElement(node)
  ) {
    context.hasJsx = true;
  }

  if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    checkUnreachable(context, node.statements);
  }

  if (ts.isCatchClause(node) && node.block.statements.length === 0) {
    addFinding(context, "empty-catch", {
      title: "Errors are silently swallowed",
      severity: "medium",
      confidence: "high",
      category: "reliability",
      explanation:
        "The catch block is empty. The failure is discarded, so the caller cannot distinguish success from a failed operation.",
      whyProblematic:
        "Silent failures leave systems in inconsistent states and make production incidents difficult to diagnose.",
      suggestedFix:
        "Handle the error explicitly. At minimum, log structured context without secrets and return a meaningful failure or recoverable default.",
      startLine: lineOf(context, node.getStart(context.sourceFile)),
      endLine: lineOf(context, node.getEnd()),
    });
  }

  if (ts.isBinaryExpression(node)) {
    checkSelfComparison(context, node);
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (
        ts.isPropertyAccessExpression(node.left) &&
        (node.left.name.text === "innerHTML" || node.left.name.text === "outerHTML") &&
        isTainted(node.right, context)
      ) {
        addTaintFinding(
          context,
          "taint-html",
          node,
          {
            title: "Untrusted input may be assigned to an HTML sink",
            severity: "high",
            category: "security",
            explanation:
              "A request-influenced value is assigned to an HTML property. The analyzer cannot confirm whether the value was sanitized before this assignment.",
            whyProblematic:
              "HTML assigned from attacker-influenced input can execute script in the page's origin.",
            suggestedFix:
              "Use textContent, or sanitize the value with a maintained allow-list sanitizer before assigning HTML.",
          },
          isSourceText(textOf(context, node.right)) ? "medium" : "low",
        );
      }
      if (ts.isIdentifier(node.left)) {
        markTaint(context, node.left.text, isTainted(node.right, context));
      }
    }
    if (
      (node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken) &&
      ts.isIdentifier(node.left)
    ) {
      markTaint(
        context,
        node.left.text,
        lookupTaint(context, node.left.text) || isTainted(node.right, context),
      );
    }
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    if (functionDepth > 0) {
      context.variables.push({
        name: node.name.text,
        line: lineOf(context, node.getStart(context.sourceFile)),
        endLine: lineOf(context, node.getEnd()),
        text: textOf(context, node),
      });
    }
    markTaint(context, node.name.text, isTainted(node.initializer, context));
  }

  if (ts.isJsxAttribute(node) && node.name.getText(context.sourceFile) === "dangerouslySetInnerHTML") {
    const initializer = node.initializer;
    if (
      initializer &&
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      ts.isObjectLiteralExpression(initializer.expression)
    ) {
      for (const property of initializer.expression.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          property.name.getText(context.sourceFile) === "__html" &&
          isTainted(property.initializer, context)
        ) {
          addTaintFinding(
            context,
            "taint-html",
            node,
            {
              title: "Untrusted input may be rendered as raw HTML",
              severity: "high",
              category: "security",
              explanation:
                "A request-influenced value reaches dangerouslySetInnerHTML. The flow is inferred within this file and may cross sanitization the analyzer cannot see.",
              whyProblematic:
                "Raw HTML from attacker-influenced input can execute script in the page's origin.",
              suggestedFix:
                "Render structured text instead, or sanitize the HTML with a maintained allow-list sanitizer.",
            },
            isSourceText(textOf(context, property.initializer)) ? "medium" : "low",
          );
          break;
        }
      }
    }
  }

  if (ts.isCallExpression(node)) {
    const calleeText = textOf(context, node.expression);
    if (calleeText === "eval" || calleeText.endsWith(".eval")) context.hasEval = true;
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteralLike(argument)) context.hasDynamicImport = true;
    }
    inspectCall(context, node);
  }
  if (ts.isNewExpression(node)) inspectCall(context, node);

  if (ts.isFunctionLike(node)) {
    context.scopes.push(new Map());
    ts.forEachChild(node, (child) => walk(child, node, functionDepth + 1, context));
    context.scopes.pop();
    return;
  }

  if (ts.isBlock(node)) {
    context.scopes.push(new Map());
    ts.forEachChild(node, (child) => walk(child, node, functionDepth, context));
    context.scopes.pop();
    return;
  }

  ts.forEachChild(node, (child) => walk(child, node, functionDepth, context));
}

function addUnusedFindings(context: JsContext): void {
  if (!context.complete) return;

  if (context.hasEval) return;

  for (const binding of context.importBindings) {
    if (binding.name.startsWith("_")) continue;
    if (binding.name === "React" && context.hasJsx) continue;
    if ((context.refCounts.get(binding.name) ?? 0) > 0) continue;
    addFinding(context, "unused-import", {
      title: "Unused import",
      severity: "low",
      confidence: "high",
      category: "maintainability",
      explanation: `The imported binding "${binding.name}" is never referenced in this file.`,
      whyProblematic:
        "Unused imports add noise to reviews and can keep dependencies or initialization work alive for no reason.",
      suggestedFix: "Remove the unused binding from the import, or use it in the intended code path.",
      startLine: binding.line,
      endLine: binding.endLine,
      evidence: binding.text,
    });
  }

  if (context.hasEval) return;
  for (const variable of context.variables) {
    if (variable.name.startsWith("_")) continue;
    if ((context.refCounts.get(variable.name) ?? 0) > 0) continue;
    addFinding(context, "unused-variable", {
      title: "Unused local variable",
      severity: "low",
      confidence: "high",
      category: "maintainability",
      explanation: `The local variable "${variable.name}" is assigned but never referenced in this file.`,
      whyProblematic:
        "An unused local usually means an intended read was lost, or that computation and side effects are being paid for without a consumer.",
      suggestedFix: "Remove the declaration, or use the value where it was intended.",
      startLine: variable.line,
      endLine: variable.endLine,
      evidence: variable.text,
    });
  }
}

function functionKind(node: ts.FunctionLikeDeclaration): FunctionMetrics["kind"] {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return "method";
  }
  if (ts.isArrowFunction(node)) return "arrow";
  return "function";
}

function functionName(node: ts.FunctionLikeDeclaration): string {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const named = node as ts.FunctionLikeDeclaration & { name?: ts.DeclarationName };
  if (named.name && (ts.isIdentifier(named.name) || ts.isStringLiteralLike(named.name))) {
    return named.name.text;
  }
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return "<anonymous>";
}

function isBooleanOperator(node: ts.BinaryExpression): boolean {
  return (
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
    node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

function countBooleanOperators(node: ts.Node): number {
  let count = 0;
  const visit = (current: ts.Node): void => {
    if (ts.isFunctionLike(current)) return;
    if (ts.isBinaryExpression(current) && isBooleanOperator(current)) count++;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return count;
}

function ternaryDepth(node: ts.Expression): number {
  if (ts.isConditionalExpression(node)) {
    return 1 + Math.max(ternaryDepth(node.whenTrue), ternaryDepth(node.whenFalse));
  }
  let depth = 0;
  ts.forEachChild(node, (child) => {
    if (ts.isExpression(child)) depth = Math.max(depth, ternaryDepth(child));
  });
  return depth;
}

function parameterCount(node: ts.FunctionLikeDeclaration): number {
  return node.parameters.filter(
    (parameter) => !(ts.isIdentifier(parameter.name) && parameter.name.text === "this"),
  ).length;
}

function measureFunction(node: ts.FunctionLikeDeclaration, context: JsContext): FunctionMetrics {
  const startLine = lineOf(context, node.getStart(context.sourceFile));
  const endLine = lineOf(context, node.getEnd());
  const metrics: FunctionMetrics = {
    name: functionName(node),
    kind: functionKind(node),
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    complexity: 1,
    maxNesting: 0,
    parameterCount: parameterCount(node),
    maxBooleanOperators: 0,
    maxTernaryDepth: 0,
  };

  const body = (node as ts.FunctionLikeDeclaration & { body?: ts.Node }).body;
  if (!body) return metrics;

  const root = body;
  const visit = (current: ts.Node, nesting: number, parent: ts.Node | null): void => {
    if (current !== root && ts.isFunctionLike(current)) return;
    let nextNesting = nesting;

    if (
      ts.isIfStatement(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current) ||
      ts.isSwitchStatement(current) ||
      ts.isTryStatement(current)
    ) {
      nextNesting = nesting + 1;
      metrics.maxNesting = Math.max(metrics.maxNesting, nextNesting);
    }

    if (
      ts.isIfStatement(current) ||
      ts.isForStatement(current) ||
      ts.isWhileStatement(current)
    ) {
      const condition = ts.isForStatement(current) ? current.condition : current.expression;
      if (condition) {
        metrics.maxBooleanOperators = Math.max(metrics.maxBooleanOperators, countBooleanOperators(condition));
      }
    }

    if (ts.isIfStatement(current) || ts.isForStatement(current) || ts.isForInStatement(current) ||
        ts.isForOfStatement(current) || ts.isWhileStatement(current) || ts.isDoStatement(current) ||
        ts.isCaseClause(current) || ts.isCatchClause(current)) {
      metrics.complexity++;
    }

    if (ts.isConditionalExpression(current)) {
      metrics.complexity++;
      metrics.maxBooleanOperators = Math.max(
        metrics.maxBooleanOperators,
        countBooleanOperators(current.condition),
      );
      metrics.maxTernaryDepth = Math.max(metrics.maxTernaryDepth, ternaryDepth(current));
    }

    if (ts.isBinaryExpression(current) && isBooleanOperator(current)) metrics.complexity++;

    ts.forEachChild(current, (child) => {
      let childNesting = nextNesting;
      if (parent && ts.isIfStatement(parent) && parent.elseStatement === child && ts.isIfStatement(child)) {
        childNesting = nesting;
      }
      visit(child, childNesting, current);
    });
  };

  visit(root, 0, null);
  return metrics;
}

function bindingNames(name: ts.BindingName, names: string[]): void {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    bindingNames(element.name, names);
  }
}

function collectDeclarations(context: JsContext): DeclarationMetric[] {
  const declarations: DeclarationMetric[] = [];
  const add = (name: string, kind: DeclarationMetric["kind"], node: ts.Node, exported: boolean) => {
    declarations.push({
      name,
      kind,
      startLine: lineOf(context, node.getStart(context.sourceFile)),
      endLine: lineOf(context, node.getEnd()),
      exported,
      references: context.refCounts.get(name) ?? 0,
    });
  };
  const exported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of context.sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      add(statement.name.text, "function", statement, exported(statement));
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      add(statement.name.text, "class", statement, exported(statement));
    } else if (ts.isInterfaceDeclaration(statement)) {
      add(statement.name.text, "interface", statement, exported(statement));
    } else if (ts.isTypeAliasDeclaration(statement)) {
      add(statement.name.text, "type", statement, exported(statement));
    } else if (ts.isEnumDeclaration(statement)) {
      add(statement.name.text, "enum", statement, exported(statement));
    } else if (ts.isVariableStatement(statement)) {
      const names: string[] = [];
      for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, names);
      for (const name of names) add(name, "variable", statement, exported(statement));
    }
  }

  return declarations;
}

function collectStructure(context: JsContext): FileStructure | null {
  let nodes = 0;
  let complete = true;
  const functions: FunctionMetrics[] = [];

  const visit = (node: ts.Node): void => {
    if (!complete) return;
    nodes++;
    if (nodes > MAX_NODES || budgetExpired(context.budget)) {
      complete = false;
      return;
    }
    if (ts.isFunctionLike(node)) {
      const declaration = node as ts.FunctionLikeDeclaration & { body?: ts.Node };
      if (declaration.body) functions.push(measureFunction(declaration, context));
    }
    ts.forEachChild(node, visit);
  };

  visit(context.sourceFile);
  if (!complete) return null;

  return {
    path: context.file.path,
    language: "js",
    lineCount: context.file.content.split(/\r?\n/).length,
    functions,
    declarations: collectDeclarations(context),
    hasDynamicEvaluation: context.hasEval || context.hasDynamicImport || context.hasDynamicRequire,
  };
}

export function analyzeJavaScriptFile(
  file: FetchedFile,
  budget: AstTimeBudget,
): FileAstResult {
  const sourceFile = ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(file.path),
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) {
    return { findings: [], imports: [], structure: null, parsed: false };
  }

  const context: JsContext = {
    file,
    sourceFile,
    budget,
    findings: [],
    imports: [],
    importBindings: [],
    variables: [],
    refCounts: new Map(),
    scopes: [new Map()],
    specialImports: new Map(),
    ruleCounts: new Map(),
    nodes: 0,
    hasEval: false,
    hasDynamicImport: false,
    hasDynamicRequire: false,
    hasJsx: false,
    complete: true,
  };

  walk(sourceFile, null, 0, context);
  addUnusedFindings(context);

  const structure = context.complete ? collectStructure(context) : null;
  if (!structure) context.complete = false;

  const weight: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  context.findings.sort(
    (a, b) => weight[a.severity] - weight[b.severity] || (a.startLine ?? 0) - (b.startLine ?? 0),
  );

  return {
    findings: context.findings.slice(0, MAX_FINDINGS_PER_FILE),
    imports: context.imports,
    structure,
    parsed: context.complete,
  };
}
