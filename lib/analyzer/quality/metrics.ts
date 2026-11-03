import type { FetchedFile } from "@/lib/github/client";
import type { Finding } from "@/lib/reports/schema";
import type { DeclarationMetric, FileStructure, FunctionMetrics } from "@/lib/analyzer/ast/types";
import { makeQualityFinding } from "./findings";

export type QualityCandidate = {
  finding: Finding;
  score: number;
};

export const COMPLEXITY_MEDIUM = 15;
export const COMPLEXITY_HIGH = 30;
export const NESTING_MEDIUM = 5;
export const NESTING_HIGH = 8;
export const FUNCTION_LINES_MEDIUM = 80;
export const FUNCTION_LINES_HIGH = 160;
export const FILE_LINES_MEDIUM = 500;
export const FILE_LINES_HIGH = 1000;
export const PARAMETERS_MEDIUM = 6;
export const PARAMETERS_HIGH = 10;
export const BOOLEAN_OPERATORS_LOW = 4;
export const BOOLEAN_OPERATORS_MEDIUM = 6;
export const TERNARY_DEPTH_LOW = 2;
export const MAX_DEAD_DECLARATIONS = 2;

const TEST_PATH = /(^|\/)(?:tests?|spec|__tests__)\//i;
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/i;
const MINIFIED_FILE = /\.min\.[^.]+$/i;

export function isQualityEligiblePath(path: string): boolean {
  return !TEST_PATH.test(path) && !TEST_FILE.test(path) && !MINIFIED_FILE.test(path);
}

function functionLabel(fn: FunctionMetrics): string {
  return `${fn.name} (lines ${fn.startLine}-${fn.endLine})`;
}

function complexityFinding(file: FetchedFile, fn: FunctionMetrics): QualityCandidate | null {
  if (fn.complexity < COMPLEXITY_MEDIUM) return null;
  const high = fn.complexity >= COMPLEXITY_HIGH;
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "complexity",
    title: high ? "Very high cyclomatic complexity" : "High cyclomatic complexity",
    severity: high ? "high" : "medium",
    confidence: "high",
    category: "maintainability",
    assessment: "measured",
    explanation: `${functionLabel(fn)} has a cyclomatic complexity of ${fn.complexity}. The function contains ${fn.complexity - 1} independent decision point${fn.complexity - 1 === 1 ? "" : "s"}.`,
    whyProblematic:
      "A high number of branches makes a function harder to review and test, and raises the chance that one path is never exercised.",
    suggestedFix:
      "Extract cohesive branches into named helpers, replace long conditional chains with a dispatch table, and add tests for each remaining branch.",
    startLine: fn.startLine,
    endLine: fn.endLine,
  });
  return { finding, score: fn.complexity / COMPLEXITY_MEDIUM };
}

function nestingFinding(file: FetchedFile, fn: FunctionMetrics): QualityCandidate | null {
  if (fn.maxNesting < NESTING_MEDIUM) return null;
  const high = fn.maxNesting >= NESTING_HIGH;
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "nesting",
    title: high ? "Deeply nested logic" : "Nested control flow",
    severity: high ? "high" : "medium",
    confidence: "high",
    category: "maintainability",
    assessment: "measured",
    explanation: `${functionLabel(fn)} reaches a nesting depth of ${fn.maxNesting} across its conditional and loop blocks.`,
    whyProblematic:
      "Deep nesting forces readers to hold several conditions in mind at once, and makes error paths and early exits easy to miss.",
    suggestedFix:
      "Return early for guard conditions, invert negative branches, and extract the innermost block into a helper with a descriptive name.",
    startLine: fn.startLine,
    endLine: fn.endLine,
  });
  return { finding, score: fn.maxNesting / NESTING_MEDIUM };
}

function functionSizeFinding(file: FetchedFile, fn: FunctionMetrics): QualityCandidate | null {
  if (fn.lineCount <= FUNCTION_LINES_MEDIUM) return null;
  const high = fn.lineCount > FUNCTION_LINES_HIGH;
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "function-size",
    title: high ? "Very large function" : "Large function",
    severity: high ? "high" : "medium",
    confidence: "high",
    category: "maintainability",
    assessment: "measured",
    explanation: `${functionLabel(fn)} spans ${fn.lineCount} lines.`,
    whyProblematic:
      "Long functions tend to mix several responsibilities, so a change in one concern can accidentally affect another.",
    suggestedFix:
      "Split the function along its existing phases or responsibilities, and keep each extracted function small enough to name precisely.",
    startLine: fn.startLine,
    endLine: fn.endLine,
  });
  return { finding, score: fn.lineCount / FUNCTION_LINES_MEDIUM };
}

function fileSizeFinding(file: FetchedFile, structure: FileStructure): QualityCandidate | null {
  if (structure.lineCount <= FILE_LINES_MEDIUM) return null;
  const high = structure.lineCount > FILE_LINES_HIGH;
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "file-size",
    title: high ? "Very large source file" : "Large source file",
    severity: high ? "high" : "medium",
    confidence: "high",
    category: "maintainability",
    assessment: "measured",
    explanation: `This file contains ${structure.lineCount} lines and ${structure.declarations.length} top-level declaration${structure.declarations.length === 1 ? "" : "s"}.`,
    whyProblematic:
      "Large files usually hold several responsibilities, increase merge conflicts, and slow down navigation and review.",
    suggestedFix:
      "Group related declarations into modules by responsibility, then update imports and tests in the same change.",
    startLine: 1,
    endLine: structure.lineCount,
  });
  return { finding, score: structure.lineCount / FILE_LINES_MEDIUM };
}

function parameterFinding(file: FetchedFile, fn: FunctionMetrics): QualityCandidate | null {
  if (fn.parameterCount < PARAMETERS_MEDIUM) return null;
  const high = fn.parameterCount >= PARAMETERS_HIGH;
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "parameters",
    title: high ? "Function has too many parameters" : "Long parameter list",
    severity: high ? "high" : "medium",
    confidence: "high",
    category: "maintainability",
    assessment: "measured",
    explanation: `${functionLabel(fn)} declares ${fn.parameterCount} parameters, excluding this/self/cls.`,
    whyProblematic:
      "Long positional parameter lists are easy to call in the wrong order and hard to extend without breaking callers.",
    suggestedFix:
      "Group related values into a typed options object, or split the function when the parameters represent separate responsibilities.",
    startLine: fn.startLine,
    endLine: fn.endLine,
  });
  return { finding, score: fn.parameterCount / PARAMETERS_MEDIUM };
}

function booleanFinding(file: FetchedFile, fn: FunctionMetrics): QualityCandidate | null {
  if (fn.maxBooleanOperators < BOOLEAN_OPERATORS_LOW) return null;
  const medium = fn.maxBooleanOperators >= BOOLEAN_OPERATORS_MEDIUM;
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "boolean-condition",
    title: "Condition combines many boolean operators",
    severity: medium ? "medium" : "low",
    confidence: "high",
    category: "maintainability",
    assessment: "measured",
    explanation: `${functionLabel(fn)} has a condition with ${fn.maxBooleanOperators} &&, ||, or ?? operators.`,
    whyProblematic:
      "Long boolean expressions are hard to evaluate by eye and easy to change incorrectly when a new case appears.",
    suggestedFix:
      "Name the intermediate predicates, or replace the expression with a small function that returns an explicit decision.",
    startLine: fn.startLine,
    endLine: fn.endLine,
  });
  return { finding, score: fn.maxBooleanOperators / BOOLEAN_OPERATORS_LOW };
}

function ternaryFinding(file: FetchedFile, fn: FunctionMetrics): QualityCandidate | null {
  if (fn.maxTernaryDepth < TERNARY_DEPTH_LOW) return null;
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "nested-ternary",
    title: "Nested ternary expression",
    severity: "low",
    confidence: "medium",
    category: "maintainability",
    assessment: "measured",
    explanation: `${functionLabel(fn)} contains a ternary expression nested ${fn.maxTernaryDepth} levels deep.`,
    whyProblematic:
      "Nested ternaries hide branch order and make the condition harder to scan than an explicit if/else chain.",
    suggestedFix: "Use an if/else chain, a switch, or a named helper that returns the selected value.",
    startLine: fn.startLine,
    endLine: fn.endLine,
  });
  return { finding, score: fn.maxTernaryDepth / TERNARY_DEPTH_LOW };
}

function deadDeclarationFinding(
  file: FetchedFile,
  declaration: DeclarationMetric,
): QualityCandidate | null {
  if (declaration.exported || declaration.references > 0) return null;
  if (declaration.name.startsWith("_")) return null;
  const finding = makeQualityFinding(file.path, file.content, {
    ruleId: "dead-declaration",
    title: "Top-level declaration is never referenced",
    severity: "low",
    confidence: "medium",
    category: "maintainability",
    assessment: "measured",
    explanation: `The module-level ${declaration.kind} "${declaration.name}" is not exported and has no identifier references in this file.`,
    whyProblematic:
      "An unreferenced declaration adds maintenance cost and may indicate an intended call site was lost during refactoring.",
    suggestedFix:
      "Remove the declaration, or export and use it if it is part of the intended module surface. Confirm with repository-wide search before deleting.",
    startLine: declaration.startLine,
    endLine: declaration.endLine,
  });
  return { finding, score: 1 };
}

function capped(
  candidates: QualityCandidate[],
  limit: number,
): QualityCandidate[] {
  return [...candidates]
    .sort(
      (a, b) =>
        a.finding.startLine! - b.finding.startLine! ||
        b.score - a.score,
    )
    .slice(0, limit);
}

export function collectMetricCandidates(
  file: FetchedFile,
  structure: FileStructure,
): QualityCandidate[] {
  if (!isQualityEligiblePath(file.path)) return [];
  const candidates: QualityCandidate[] = [];

  const complexity: QualityCandidate[] = [];
  const nesting: QualityCandidate[] = [];
  const sizes: QualityCandidate[] = [];
  const parameters: QualityCandidate[] = [];
  const booleans: QualityCandidate[] = [];
  const ternaries: QualityCandidate[] = [];

  for (const fn of structure.functions) {
    const values = [
      complexityFinding(file, fn),
      nestingFinding(file, fn),
      functionSizeFinding(file, fn),
      parameterFinding(file, fn),
      booleanFinding(file, fn),
      ternaryFinding(file, fn),
    ];
    if (values[0]) complexity.push(values[0]);
    if (values[1]) nesting.push(values[1]);
    if (values[2]) sizes.push(values[2]);
    if (values[3]) parameters.push(values[3]);
    if (values[4]) booleans.push(values[4]);
    if (values[5]) ternaries.push(values[5]);
  }

  candidates.push(...capped(complexity, 3));
  candidates.push(...capped(nesting, 2));
  candidates.push(...capped(sizes, 2));

  const fileCandidate = fileSizeFinding(file, structure);
  if (fileCandidate) candidates.push(fileCandidate);

  candidates.push(...capped(parameters, 2));
  candidates.push(...capped(booleans, 1));
  candidates.push(...capped(ternaries, 1));

  if (!structure.hasDynamicEvaluation) {
    const dead = structure.declarations
      .map((declaration) => deadDeclarationFinding(file, declaration))
      .filter((candidate): candidate is QualityCandidate => candidate !== null);
    candidates.push(...capped(dead, MAX_DEAD_DECLARATIONS));
  }

  return candidates;
}
