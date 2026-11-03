import { AnalysisError } from "@/lib/errors";
import { parseGitHubRepoUrl } from "@/lib/github/url";
import {
  fetchDependencyFiles,
  fetchFiles,
  fetchLanguages,
  fetchRepoMetadata,
  fetchRepoTree,
  type FetchedFile,
} from "@/lib/github/client";
import { selectFiles } from "@/lib/analyzer/select-files";
import { analyzeStaticFiles } from "@/lib/analyzer/static";
import { analyzeAstFiles } from "@/lib/analyzer/ast";
import { analyzeCodeQuality } from "@/lib/analyzer/quality";
import { analyzeArchitecture } from "@/lib/analyzer/architecture";
import { analyzeDependencies } from "@/lib/analyzer/dependencies";
import { planDependencyFiles } from "@/lib/analyzer/dependencies/files";
import { MAX_DEPENDENCY_FILE_CHARS } from "@/lib/analyzer/dependencies/limits";
import { reviewRepositoryWithAI } from "@/lib/ai/analyze";
import { reportSchema, type Finding, type Report, type Severity } from "@/lib/reports/schema";

const DEFAULT_MAX_REPO_MB = 250;

function maxRepoKb(): number {
  const configured = Number(process.env.MAX_REPO_SIZE_MB);
  const mb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_REPO_MB;
  return Math.round(mb * 1024);
}

function languageBreakdown(languages: Array<{ name: string; bytes: number }>) {
  const total = languages.reduce((sum, language) => sum + language.bytes, 0);
  return languages
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6)
    .map((language) => ({
      name: language.name,
      percentage: total > 0 ? Math.round((language.bytes / total) * 1000) / 10 : 0,
    }));
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const result: Finding[] = [];

  for (const finding of findings) {
    const titleKey = finding.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const relatedKey =
      finding.relatedLocations
        ?.map((location) => `${location.file}:${location.startLine}:${location.endLine}`)
        .sort()
        .join(",") ?? "";
    const lineBucket = finding.startLine ? Math.floor((finding.startLine - 1) / 6) : null;
    const primaryKey = `${finding.file ?? "repo"}|${finding.category}|${titleKey}|${relatedKey}`;
    const locationKey =
      lineBucket !== null
        ? `${finding.file ?? "repo"}|${finding.category}|line:${lineBucket}|${relatedKey}`
        : null;

    if (seen.has(primaryKey) || (locationKey !== null && seen.has(locationKey))) continue;
    seen.add(primaryKey);
    if (locationKey) seen.add(locationKey);
    result.push(finding);
  }

  const severityWeight: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const confidenceWeight = { high: 0, medium: 1, low: 2 } as const;
  const sourceWeight: Record<Finding["source"], number> = {
    static: 0,
    ast: 1,
    quality: 2,
    dependency: 3,
    ai: 4,
  };

  return result
    .sort(
      (a, b) =>
        severityWeight[a.severity] - severityWeight[b.severity] ||
        confidenceWeight[a.confidence] - confidenceWeight[b.confidence] ||
        Number(b.evidenceStatus === "verified") - Number(a.evidenceStatus === "verified") ||
        (a.file ?? "").localeCompare(b.file ?? "") ||
        (a.startLine ?? 0) - (b.startLine ?? 0) ||
        sourceWeight[a.source] - sourceWeight[b.source],
    )
    .slice(0, 30);
}

function makeSummary(
  findings: Finding[],
  filesAnalyzed: number,
  aiEnabled: boolean,
  dependencyEnabled: boolean,
): string {
  if (findings.length === 0) {
    return `No evidence-backed issues were identified in ${filesAnalyzed} analyzed file${filesAnalyzed === 1 ? "" : "s"}. This is not proof that the repository is free of defects: coverage is intentionally limited.`;
  }

  const counts = findings.reduce<Record<Severity, number>>(
    (accumulator, finding) => {
      accumulator[finding.severity]++;
      return accumulator;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
  const verified = findings.filter((finding) => finding.evidenceStatus === "verified").length;
  const hypotheses = findings.length - verified;
  const stages = [
    "deterministic static rules",
    "AST structural analysis",
    "code quality and architecture analysis",
    ...(dependencyEnabled ? ["dependency vulnerability analysis"] : []),
    ...(aiEnabled ? ["validated AI review"] : []),
  ];
  const mode = `${stages.slice(0, -1).join(", ")}${stages.length > 1 ? ", and " : ""}${stages[stages.length - 1]}`;

  return `Found ${findings.length} potential issue${findings.length === 1 ? "" : "s"} across ${filesAnalyzed} analyzed files (critical ${counts.critical}, high ${counts.high}, medium ${counts.medium}, low ${counts.low}) using ${mode}. ${verified} finding${verified === 1 ? " has" : "s have"} source-matched evidence; ${hypotheses} ${hypotheses === 1 ? "remains an unverified hypothesis" : "remain unverified hypotheses"}. Review every item before filing.`;
}

export async function analyzeRepository(inputUrl: string): Promise<Report> {
  const startedAt = Date.now();
  let ref;
  try {
    ref = parseGitHubRepoUrl(inputUrl);
  } catch (error) {
    throw new AnalysisError(
      error instanceof Error ? error.message : "Enter a valid GitHub repository URL.",
      400,
      "invalid_url",
    );
  }
  const warnings: string[] = [];

  const [repo, languageResult] = await Promise.all([
    fetchRepoMetadata(ref),
    fetchLanguages(ref).catch(() => {
      warnings.push("Language metadata was unavailable.");
      return [] as Array<{ name: string; bytes: number }>;
    }),
  ]);

  if (repo.sizeKb > maxRepoKb()) {
    throw new AnalysisError(
      `This repository is ${Math.round(repo.sizeKb / 1024)} MB, above Saulify's ${Math.round(maxRepoKb() / 1024)} MB safety limit. Try a smaller repository.`,
      413,
      "repo_too_large",
    );
  }

  if (repo.archived) {
    warnings.push("This repository is archived. Findings may no longer be maintained.");
  }

  const tree = await fetchRepoTree(ref, repo.defaultBranch);
  if (tree.truncated) {
    warnings.push("GitHub truncated the repository tree; the analysis covers only the returned portion.");
  }

  const selection = selectFiles(tree.entries);
  if (selection.eligible > selection.selected.length) {
    warnings.push(
      `Coverage limit: analyzing ${selection.selected.length} of ${selection.eligible} matching source files.`,
    );
  }

  const fetched = await fetchFiles(ref, repo.defaultBranch, selection.selected);
  if (fetched.skipped > 0) {
    warnings.push(`${fetched.skipped} selected file${fetched.skipped === 1 ? "" : "s"} could not be retrieved or decoded.`);
  }

  const order = new Map(selection.selected.map((path, index) => [path, index]));
  const files: FetchedFile[] = [...fetched.files].sort(
    (a, b) => (order.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.path) ?? Number.MAX_SAFE_INTEGER),
  );

  if (files.length === 0) {
    warnings.push(
      "No supported source files were retrieved. Saulify analyzes selected JS/TS, Python, and other common source/config files; empty or unsupported repositories will produce no findings.",
    );
  }

  const languages = languageBreakdown(languageResult);
  const dependencyPlan = planDependencyFiles(tree.entries);
  const dependencyPromise = (async () => {
    const fetchedDependencies = await fetchDependencyFiles(
      ref,
      repo.defaultBranch,
      dependencyPlan.paths,
      MAX_DEPENDENCY_FILE_CHARS,
    );
    if (fetchedDependencies.skipped > 0) {
      warnings.push(
        `${fetchedDependencies.skipped} dependency file${fetchedDependencies.skipped === 1 ? "" : "s"} could not be retrieved or exceeded the size limit.`,
      );
    }
    return analyzeDependencies(fetchedDependencies.files, {
      sourceFiles: files,
      fullCoverage:
        selection.eligible <= selection.selected.length && files.length === selection.selected.length,
      eligibleFiles: selection.eligible,
      analyzedFiles: files.length,
    });
  })();
  const aiPromise = reviewRepositoryWithAI(repo, files, languages);

  const staticFindings = analyzeStaticFiles(files);
  const knownPaths = tree.truncated
    ? undefined
    : new Set(tree.entries.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  const ast = analyzeAstFiles(files, { knownPaths });
  if (ast.warning) warnings.push(ast.warning);

  const fullCoverage =
    selection.eligible <= selection.selected.length && files.length === selection.selected.length;
  const quality = analyzeCodeQuality(files, ast.structures, {
    timeBudgetMs: 1_500,
  });
  if (quality.warning) warnings.push(quality.warning);

  const architecture = analyzeArchitecture({
    files,
    treeEntries: tree.entries,
    treeTruncated: tree.truncated,
    imports: ast.imports,
    analyzedPaths: ast.structures.map((structure) => structure.path),
    knownPaths: knownPaths ?? new Set(ast.structures.map((structure) => structure.path)),
    fullCoverage,
    timeBudgetMs: 1_000,
  });
  if (architecture.warning) warnings.push(architecture.warning);

  const [dependency, ai] = await Promise.all([dependencyPromise, aiPromise]);
  warnings.push(...dependencyPlan.warnings);
  warnings.push(...dependency.warnings);
  if (ai.warning) warnings.push(ai.warning);

  const findings = dedupeFindings([
    ...staticFindings,
    ...ast.findings,
    ...quality.findings,
    ...architecture.findings,
    ...dependency.findings,
    ...ai.findings,
  ]);
  const durationMs = Math.max(0, Date.now() - startedAt);

  const report: Report = {
    version: 1,
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    repo: {
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      htmlUrl: repo.htmlUrl,
      issuesUrl: repo.issuesUrl,
      description: repo.description,
      defaultBranch: repo.defaultBranch,
      stars: repo.stars,
      forks: repo.forks,
      sizeKb: repo.sizeKb,
      license: repo.license,
      archived: repo.archived,
      pushedAt: repo.pushedAt,
    },
    languages:
      languages.length > 0
        ? languages
        : repo.language
          ? [{ name: repo.language, percentage: 100 }]
          : [],
    mode: {
      ai: ai.enabled,
      provider: ai.provider,
      model: ai.model,
      note: ai.note,
    },
    stats: {
      treeEntries: tree.entries.length,
      filesSelected: selection.selected.length,
      filesAnalyzed: files.length,
      filesSkipped: Math.max(0, tree.entries.length - files.length),
      treeTruncated: tree.truncated,
      durationMs,
    },
    warnings,
    summary: makeSummary(findings, files.length, ai.enabled, dependencyPlan.paths.length > 0),
    findings,
  };

  return reportSchema.parse(report);
}
