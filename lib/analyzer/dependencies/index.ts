import {
  MAX_OUTDATED_FINDINGS,
  MAX_UNUSED_FINDINGS,
  MAX_VULNERABILITY_FINDINGS,
} from "@/lib/analyzer/dependencies/limits";
import { parseNpmProject } from "@/lib/analyzer/dependencies/parsers/npm";
import { parsePythonProject } from "@/lib/analyzer/dependencies/parsers/python";
import {
  buildOutdatedFinding,
  buildUnusedFinding,
  buildVulnerabilityFinding,
} from "@/lib/analyzer/dependencies/findings";
import { lookupVulnerabilities } from "@/lib/analyzer/dependencies/osv";
import { isOutdatedVersion, lookupLatestVersions } from "@/lib/analyzer/dependencies/registry";
import { findUnusedDependencies } from "@/lib/analyzer/dependencies/unused";
import type { DependencyFile, DependencyPackage } from "@/lib/analyzer/dependencies/types";
import type { FetchedFile } from "@/lib/github/client";
import type { Finding } from "@/lib/reports/schema";

const NPM_FILES = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const PYTHON_FILES = new Set([
  "requirements.txt",
  "poetry.lock",
  "uv.lock",
  "pdm.lock",
  "Pipfile.lock",
]);

export type DependencyAnalysisOptions = {
  sourceFiles: FetchedFile[];
  fullCoverage: boolean;
  eligibleFiles: number;
  analyzedFiles: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export async function analyzeDependencies(
  files: DependencyFile[],
  options: DependencyAnalysisOptions,
): Promise<{ findings: Finding[]; warnings: string[] }> {
  if (files.length === 0) return { findings: [], warnings: [] };

  const npmFiles = files.filter((file) => NPM_FILES.has(file.path));
  const pythonFiles = files.filter((file) => PYTHON_FILES.has(file.path));
  const warnings: string[] = [];
  const packages: DependencyPackage[] = [];

  if (npmFiles.length > 0) {
    const parsed = parseNpmProject(npmFiles);
    packages.push(...parsed.packages);
    warnings.push(...parsed.warnings);
  }
  if (pythonFiles.length > 0) {
    const parsed = parsePythonProject(pythonFiles);
    packages.push(...parsed.packages);
    warnings.push(...parsed.warnings);
  }

  const exact = packages.filter((pkg) => pkg.version !== null);
  if (packages.length > 0 && exact.length === 0) {
    warnings.push(
      "Dependency vulnerability lookup was skipped because no exact installed versions were found. Add a supported lockfile or pin requirements to enable OSV version matching.",
    );
  }

  const osv = exact.length > 0
    ? await lookupVulnerabilities(exact, {
        fetchImpl: options.fetchImpl,
        now: options.now,
      })
    : { matches: [], warnings: [] };
  warnings.push(...osv.warnings);

  const vulnerabilityFindings: Finding[] = [];
  const vulnerable = new Set<string>();
  for (const match of osv.matches) {
    const finding = buildVulnerabilityFinding(match.package, match.vuln);
    if (!finding) continue;
    vulnerable.add(`${match.package.ecosystem}|${match.package.name}`);
    vulnerabilityFindings.push(finding);
  }

  if (vulnerabilityFindings.length > MAX_VULNERABILITY_FINDINGS) {
    warnings.push(
      `Dependency vulnerability finding limit reached: ${vulnerabilityFindings.length - MAX_VULNERABILITY_FINDINGS} lower-priority vulnerabilities were omitted.`,
    );
  }

  const outdatedCandidates = packages
    .filter(
      (pkg) =>
        pkg.direct &&
        pkg.version !== null &&
        !vulnerable.has(`${pkg.ecosystem}|${pkg.name}`),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const registry = await lookupLatestVersions(outdatedCandidates, {
    fetchImpl: options.fetchImpl,
    now: options.now,
  });
  warnings.push(...registry.warnings);

  const outdatedFindings: Finding[] = [];
  for (const pkg of outdatedCandidates) {
    if (!pkg.version) continue;
    const latest = registry.versions.get(`${pkg.ecosystem}|${pkg.name}`);
    if (!latest || !isOutdatedVersion(pkg.version, latest)) continue;
    outdatedFindings.push(buildOutdatedFinding(pkg, latest));
  }
  if (outdatedFindings.length > MAX_OUTDATED_FINDINGS) {
    warnings.push(
      `Outdated dependency suggestion limit reached: ${outdatedFindings.length - MAX_OUTDATED_FINDINGS} suggestions were omitted.`,
    );
  }

  const manifest = files.find((file) => file.path === "package.json");
  const unused = findUnusedDependencies(packages, options.sourceFiles, {
    fullCoverage: options.fullCoverage,
    eligibleFiles: options.eligibleFiles,
    analyzedFiles: options.analyzedFiles,
    manifestContent: manifest?.content ?? null,
  });
  if (unused.warning) warnings.push(unused.warning);

  const unusedFindings = unused.suggestions
    .slice(0, MAX_UNUSED_FINDINGS)
    .map((pkg) => buildUnusedFinding(pkg, options.analyzedFiles));

  const combined = [
    ...vulnerabilityFindings.slice(0, MAX_VULNERABILITY_FINDINGS),
    ...outdatedFindings,
    ...unusedFindings,
  ];
  const findings = combined.slice(0, MAX_VULNERABILITY_FINDINGS);
  if (combined.length > findings.length) {
    warnings.push(
      `Dependency finding limit reached: ${combined.length - findings.length} lower-priority findings were omitted.`,
    );
  }

  return { findings, warnings };
}
