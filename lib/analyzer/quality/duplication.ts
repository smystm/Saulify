import type { FetchedFile } from "@/lib/github/client";
import type { Finding } from "@/lib/reports/schema";
import { hash } from "@/lib/analyzer/ast/findings";
import { makeQualityFinding } from "./findings";
import { isQualityEligiblePath } from "./metrics";

export const DUPLICATE_WINDOW_LINES = 10;
export const DUPLICATE_MIN_TOKENS = 40;
export const DUPLICATE_MAX_WINDOWS = 50_000;
export const DUPLICATE_MAX_HASHES = 20_000;
export const DUPLICATE_MAX_FINDINGS = 3;

const KEYWORDS = new Set([
  "if", "else", "elif", "for", "while", "do", "switch", "case", "default", "break", "continue",
  "return", "function", "class", "const", "let", "var", "import", "export", "from", "try", "catch",
  "finally", "throw", "new", "typeof", "instanceof", "in", "of", "async", "await", "yield",
  "extends", "implements", "interface", "type", "enum", "public", "private", "protected", "static",
  "readonly", "declare", "namespace", "as", "with", "pass", "def", "lambda", "and", "or", "not",
  "is", "none", "true", "false", "raise", "except", "global", "nonlocal", "assert", "del", "match",
]);

type NormalizedLine = {
  line: number;
  exact: string;
  near: string;
  tokens: number;
};

type Window = {
  file: string;
  language: "js" | "py";
  start: number;
  end: number;
  exactHash: string;
  nearHash: string;
  tokens: number;
};

type Region = {
  file: string;
  start: number;
  end: number;
};

type Match = {
  primary: Region;
  related: Region;
  length: number;
  tokens: number;
  exact: boolean;
  language: "js" | "py";
};

function stripComments(line: string, language: "js" | "py", block: { value: boolean }): string {
  let result = "";
  let quote: string | null = null;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (block.value) {
      if (character === "*" && line[index + 1] === "/") {
        block.value = false;
        index++;
      }
      continue;
    }
    if (quote) {
      result += character;
      if (character === "\\") {
        result += line[index + 1] ?? "";
        index++;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && line[index + 1] === "*") {
      block.value = true;
      index++;
      continue;
    }
    if (character === "/" && line[index + 1] === "/") break;
    if (character === "#" && language === "py") break;
    result += character;
  }
  return result;
}

function tokensOf(line: string): string[] {
  const tokens: string[] = [];
  const pattern =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([^\s])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match[1]) tokens.push("S");
    else if (match[2]) tokens.push("N");
    else tokens.push(match[3] ?? match[4]);
  }
  return tokens;
}

function nearText(tokens: string[]): string {
  return tokens
    .map((token) => {
      if (token === "S" || token === "N") return token;
      if (/^[A-Za-z_$]/.test(token)) return KEYWORDS.has(token.toLowerCase()) ? token : "I";
      return token;
    })
    .join(" ");
}

function isSkippableLine(exact: string): boolean {
  if (!exact) return true;
  if (/^[{}()[\];,]+$/.test(exact)) return true;
  if (/^import\b/.test(exact)) return true;
  if (/^from\s+\S+\s+import\b/.test(exact)) return true;
  if (/^export\s+(?:\{|\*)/.test(exact)) return true;
  if (/^#\s*(?:include|import|pragma)\b/.test(exact)) return true;
  return false;
}

function normalizeFile(file: FetchedFile, language: "js" | "py"): NormalizedLine[] {
  const block = { value: false };
  const lines = file.content.split(/\r?\n/);
  const result: NormalizedLine[] = [];

  for (let index = 0; index < lines.length; index++) {
    const withoutComments = stripComments(lines[index], language, block);
    const exact = withoutComments.replace(/\s+/g, " ").trim();
    if (isSkippableLine(exact)) continue;
    const tokens = tokensOf(exact);
    if (tokens.length === 0) continue;
    result.push({
      line: index + 1,
      exact,
      near: nearText(tokens),
      tokens: tokens.length,
    });
  }

  return result;
}

function windowHash(lines: NormalizedLine[], start: number, key: "exact" | "near"): string {
  return hash(lines.slice(start, start + DUPLICATE_WINDOW_LINES).map((line) => line[key]).join("\n"));
}

function overlaps(a: Region, b: Region): boolean {
  return a.file === b.file && a.start <= b.end && b.start <= a.end;
}

function usedOverlaps(regions: Region[], candidate: Region): boolean {
  return regions.some((region) => overlaps(region, candidate));
}

function extendMatch(
  primaryLines: NormalizedLine[],
  relatedLines: NormalizedLine[],
  primaryStart: number,
  relatedStart: number,
  exact: boolean,
): Match {
  const primaryEnd = primaryStart + DUPLICATE_WINDOW_LINES - 1;
  const relatedEnd = relatedStart + DUPLICATE_WINDOW_LINES - 1;
  let startOffset = 0;
  while (
    primaryStart - startOffset - 1 >= 0 &&
    relatedStart - startOffset - 1 >= 0 &&
    (exact
      ? primaryLines[primaryStart - startOffset - 1].exact === relatedLines[relatedStart - startOffset - 1].exact
      : primaryLines[primaryStart - startOffset - 1].near === relatedLines[relatedStart - startOffset - 1].near)
  ) {
    startOffset++;
  }

  let endOffset = 0;
  while (
    primaryEnd + endOffset + 1 < primaryLines.length &&
    relatedEnd + endOffset + 1 < relatedLines.length &&
    (exact
      ? primaryLines[primaryEnd + endOffset + 1].exact === relatedLines[relatedEnd + endOffset + 1].exact
      : primaryLines[primaryEnd + endOffset + 1].near === relatedLines[relatedEnd + endOffset + 1].near)
  ) {
    endOffset++;
  }

  const primaryStartFinal = primaryStart - startOffset;
  const relatedStartFinal = relatedStart - startOffset;
  const length = DUPLICATE_WINDOW_LINES + startOffset + endOffset;
  const primary = { file: "", start: primaryStartFinal, end: primaryStartFinal + length - 1 };
  const related = { file: "", start: relatedStartFinal, end: relatedStartFinal + length - 1 };
  let tokens = 0;
  for (let index = 0; index < length; index++) tokens += primaryLines[primaryStartFinal + index].tokens;

  return { primary, related, length, tokens, exact, language: "js" };
}

export function findDuplicateFindings(
  files: FetchedFile[],
  parsedPaths: Set<string>,
  options: { timeBudgetMs?: number; now?: () => number; maxFindings?: number } = {},
): { findings: Finding[]; timedOut: boolean } {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeBudgetMs ?? 1_500);
  const maxFindings = options.maxFindings ?? DUPLICATE_MAX_FINDINGS;
  const byPath = new Map(files.map((file) => [file.path, file]));
  const normalized = new Map<string, NormalizedLine[]>();
  const groups = new Map<string, Window[]>();
  let windows = 0;
  let timedOut = false;

  for (const file of files) {
    if (now() > deadline) {
      timedOut = true;
      break;
    }
    if (!parsedPaths.has(file.path) || !isQualityEligiblePath(file.path)) continue;
    const language: "js" | "py" | null = /\.py$/i.test(file.path)
      ? "py"
      : /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i.test(file.path)
        ? "js"
        : null;
    if (!language) continue;

    const lines = normalizeFile(file, language);
    normalized.set(file.path, lines);
    if (lines.length < DUPLICATE_WINDOW_LINES) continue;

    for (let start = 0; start + DUPLICATE_WINDOW_LINES <= lines.length; start++) {
      if (windows >= DUPLICATE_MAX_WINDOWS || groups.size >= DUPLICATE_MAX_HASHES) break;
      const slice = lines.slice(start, start + DUPLICATE_WINDOW_LINES);
      const tokens = slice.reduce((sum, line) => sum + line.tokens, 0);
      if (tokens < DUPLICATE_MIN_TOKENS) continue;
      const item: Window = {
        file: file.path,
        language,
        start,
        end: start + DUPLICATE_WINDOW_LINES - 1,
        exactHash: windowHash(lines, start, "exact"),
        nearHash: windowHash(lines, start, "near"),
        tokens,
      };
      windows++;
      const key = `${language}:${item.nearHash}`;
      const group = groups.get(key) ?? [];
      if (group.length < 24) group.push(item);
      groups.set(key, group);
    }
  }

  const matches: Match[] = [];

  for (const group of groups.values()) {
    if (now() > deadline) {
      timedOut = true;
      break;
    }
    if (group.length < 2) continue;

    let best: Match | null = null;
    for (let left = 0; left < group.length && !best; left++) {
      for (let right = left + 1; right < group.length; right++) {
        const a = group[left];
        const b = group[right];
        if (a.file === b.file && Math.abs(a.start - b.start) < DUPLICATE_WINDOW_LINES) continue;
        const primaryLines = normalized.get(a.file);
        const relatedLines = normalized.get(b.file);
        if (!primaryLines || !relatedLines) continue;
        const exact = a.exactHash === b.exactHash;
        const match = extendMatch(primaryLines, relatedLines, a.start, b.start, exact);
        match.primary.file = a.file;
        match.related.file = b.file;
        match.language = a.language;
        best = match;
        break;
      }
    }

    if (best) matches.push(best);
  }

  matches.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      b.length - a.length ||
      b.tokens - a.tokens ||
      a.primary.file.localeCompare(b.primary.file) ||
      a.primary.start - b.primary.start,
  );

  const used: Region[] = [];
  const findings: Finding[] = [];

  for (const match of matches) {
    if (findings.length >= maxFindings) break;
    if (usedOverlaps(used, match.primary) || usedOverlaps(used, match.related)) continue;
    const primaryFile = byPath.get(match.primary.file);
    const relatedFile = byPath.get(match.related.file);
    const primaryLines = normalized.get(match.primary.file);
    const relatedLines = normalized.get(match.related.file);
    if (!primaryFile || !relatedFile || !primaryLines || !relatedLines) continue;

    const primaryStartLine = primaryLines[match.primary.start].line;
    const primaryEndLine = primaryLines[match.primary.end].line;
    const relatedStartLine = relatedLines[match.related.start].line;
    const relatedEndLine = relatedLines[match.related.end].line;
    const primarySnippet = primaryFile.content
      .split(/\r?\n/)
      .slice(primaryStartLine - 1, primaryEndLine)
      .join("\n")
      .slice(0, 1_000);
    const relatedSnippet = relatedFile.content
      .split(/\r?\n/)
      .slice(relatedStartLine - 1, relatedEndLine)
      .join("\n")
      .slice(0, 700);

    const severity = match.length >= DUPLICATE_WINDOW_LINES * 2 ? "medium" : "low";
    const finding = makeQualityFinding(primaryFile.path, primaryFile.content, {
      ruleId: "duplicate-block",
      title:
        match.primary.file === match.related.file
          ? "Duplicated code block within a file"
          : "Duplicated code block across analyzed files",
      severity,
      confidence: match.exact ? "high" : "medium",
      category: "maintainability",
      assessment: "measured",
      explanation: `${match.length} normalized lines (${match.tokens} tokens) match ${match.primary.file === match.related.file ? "elsewhere in the same file" : "in another analyzed file"}. ${match.exact ? "Identifiers and literals are identical." : "Identifiers or literals differ, so this is a renamed or lightly edited copy."}`,
      whyProblematic:
        "Copied logic must be fixed in every copy, and small edits tend to make the copies diverge in behavior.",
      suggestedFix:
        "Extract the shared behavior into one function or module, then replace both copies and add a test that covers the shared contract.",
      startLine: primaryStartLine,
      endLine: primaryEndLine,
      evidence: `Matching lines: ${match.length}, tokens: ${match.tokens} (${match.exact ? "exact" : "renamed"})\n\n${match.primary.file}:${primaryStartLine}-${primaryEndLine}\n${primarySnippet}\n\n${match.related.file}:${relatedStartLine}-${relatedEndLine}\n${relatedSnippet}`,
      relatedLocations: [
        { file: match.related.file, startLine: relatedStartLine, endLine: relatedEndLine },
      ],
    });
    findings.push(finding);
    used.push(match.primary, match.related);
  }

  return { findings, timedOut };
}
