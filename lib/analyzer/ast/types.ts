import type { Finding } from "@/lib/reports/schema";

export type AstImport = {
  specifier: string;
  line: number;
  endLine: number;
  text: string;
  language: "js" | "py";
  typeOnly?: boolean;
  moduleKind?: "esm" | "cjs";
  python?: {
    level: number;
    module: string;
    names: string[];
  };
};

export type FunctionMetrics = {
  name: string;
  kind: "function" | "method" | "arrow" | "constructor" | "lambda";
  startLine: number;
  endLine: number;
  lineCount: number;
  complexity: number;
  maxNesting: number;
  parameterCount: number;
  maxBooleanOperators: number;
  maxTernaryDepth: number;
};

export type DeclarationMetric = {
  name: string;
  kind: "function" | "class" | "variable" | "interface" | "type" | "enum";
  startLine: number;
  endLine: number;
  exported: boolean;
  references: number;
};

export type FileStructure = {
  path: string;
  language: "js" | "py";
  lineCount: number;
  functions: FunctionMetrics[];
  declarations: DeclarationMetric[];
  hasDynamicEvaluation: boolean;
};

export type FileAstResult = {
  findings: Finding[];
  imports: AstImport[];
  structure: FileStructure | null;
  parsed: boolean;
};

export type AstTimeBudget = {
  now: () => number;
  deadline: number;
};

export function createBudget(now: () => number, timeBudgetMs: number): AstTimeBudget {
  return { now, deadline: now() + timeBudgetMs };
}

export function budgetExpired(budget: AstTimeBudget): boolean {
  return budget.now() > budget.deadline;
}
