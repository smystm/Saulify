import { buildIssue } from "@/lib/analyzer/static";
import { severityFromOsv } from "@/lib/analyzer/dependencies/severity";
import type { OsvVulnerability } from "@/lib/analyzer/dependencies/osv";
import type { DependencyPackage } from "@/lib/analyzer/dependencies/types";
import type { Category, Confidence, Finding, Severity } from "@/lib/reports/schema";

function hash(input: string): string {
  let value = 2166136261;
  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function matchingAffected(pkg: DependencyPackage, vuln: OsvVulnerability) {
  return (vuln.affected ?? []).filter(
    (entry) =>
      entry.package?.ecosystem === pkg.ecosystem &&
      entry.package?.name?.toLowerCase() === pkg.name.toLowerCase(),
  );
}

function describeAffected(pkg: DependencyPackage, vuln: OsvVulnerability): string {
  const parts: string[] = [];
  for (const entry of matchingAffected(pkg, vuln)) {
    for (const range of entry.ranges ?? []) {
      const events = range.events ?? [];
      const introduced = events.find((event) => event.introduced)?.introduced;
      const fixed = events.find((event) => event.fixed)?.fixed;
      const lastAffected = events.find((event) => event.last_affected)?.last_affected;
      const limit = events.find((event) => event.limit)?.limit;
      const clauses: string[] = [];
      if (introduced && introduced !== "0") clauses.push(`>= ${introduced}`);
      if (fixed) clauses.push(`< ${fixed}`);
      if (lastAffected) clauses.push(`<= ${lastAffected}`);
      if (limit) clauses.push(`< ${limit}`);
      if (clauses.length > 0) parts.push(clauses.join(", "));
    }
    if (entry.versions && entry.versions.length > 0) {
      parts.push(
        entry.versions.length <= 6
          ? `versions ${entry.versions.join(", ")}`
          : `${entry.versions.length} listed versions`,
      );
    }
  }
  return parts.length > 0 ? [...new Set(parts)].join("; ").slice(0, 600) : "not specified";
}

function fixedVersions(pkg: DependencyPackage, vuln: OsvVulnerability): string[] {
  const versions = matchingAffected(pkg, vuln).flatMap((entry) =>
    (entry.ranges ?? []).flatMap((range) =>
      (range.events ?? []).flatMap((event) => (event.fixed ? [event.fixed] : [])),
    ),
  );
  return [...new Set(versions)].slice(0, 5);
}

function referencesFor(vuln: OsvVulnerability): string[] {
  const references = [`https://osv.dev/vulnerability/${encodeURIComponent(vuln.id)}`];
  for (const reference of vuln.references ?? []) {
    if (!reference.url || !reference.url.startsWith("https://") || reference.url.length > 500) continue;
    references.push(reference.url);
  }
  return [...new Set(references)].slice(0, 8);
}

function makeDependencyFinding(input: {
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  category: Category;
  explanation: string;
  whyProblematic: string;
  suggestedFix: string;
  evidence: string;
  evidenceStatus: "verified" | "unverified";
  pkg: DependencyPackage;
  references?: string[];
}): Finding {
  const base = {
    title: input.title.slice(0, 200),
    severity: input.severity,
    confidence: input.confidence,
    category: input.category,
    explanation: truncate(input.explanation, 4000),
    whyProblematic: truncate(input.whyProblematic, 3000),
    suggestedFix: truncate(input.suggestedFix, 3000),
    evidence: truncate(input.evidence, 2400),
    file: input.pkg.manifest,
    startLine: null,
    endLine: null,
    source: "dependency" as const,
    evidenceStatus: input.evidenceStatus,
    references: input.references,
    dependency: {
      ecosystem: input.pkg.ecosystem,
      name: input.pkg.name,
      installedVersion: input.pkg.version,
      declaredRange: input.pkg.declaredRange,
      manifest: input.pkg.manifest,
    },
  };

  return {
    id: `dependency-${hash(
      `${input.ruleId}:${input.pkg.ecosystem}:${input.pkg.name}:${input.pkg.version ?? ""}:${input.pkg.manifest}`,
    )}`,
    ...base,
    issue: buildIssue(base),
  };
}

export function buildVulnerabilityFinding(
  pkg: DependencyPackage,
  vuln: OsvVulnerability,
): Finding | null {
  if (!pkg.version || matchingAffected(pkg, vuln).length === 0) return null;

  const severity = severityFromOsv(vuln);
  const affected = describeAffected(pkg, vuln);
  const fixed = fixedVersions(pkg, vuln);
  const aliases = (vuln.aliases ?? []).filter((alias) => alias.length <= 100).slice(0, 6);
  const summary = vuln.summary?.trim() || `OSV advisory ${vuln.id}`;
  const details = vuln.details?.trim() ?? "";
  const references = referencesFor(vuln);
  const remediation = fixed.length
    ? `Upgrade ${pkg.name} to ${fixed[0]} or later, regenerate the lockfile, and run the project's tests.`
    : "No fixed version is published in this advisory. Review the advisory for mitigations or replace the dependency.";

  return makeDependencyFinding({
    ruleId: `osv:${vuln.id}`,
    title: `Vulnerable dependency: ${pkg.name}@${pkg.version} (${vuln.id})`,
    severity: severity.severity,
    confidence: "high",
    category: "security",
    explanation: `${summary}${aliases.length ? ` Aliases: ${aliases.join(", ")}.` : ""}\n\n${details}`,
    whyProblematic: `The lockfile resolves ${pkg.name} to ${pkg.version}, which OSV lists as affected by ${vuln.id}. This is a matching vulnerability record, not a confirmed exploit; review the advisory before treating it as reachable.`,
    suggestedFix: `${remediation} Saulify does not modify dependencies.`,
    evidence: [
      `Advisory: ${vuln.id}`,
      aliases.length ? `Aliases: ${aliases.join(", ")}` : null,
      `Ecosystem: ${pkg.ecosystem}`,
      `Package: ${pkg.name}`,
      `Installed: ${pkg.version}`,
      `Manifest: ${pkg.manifest}`,
      `Affected: ${affected}`,
      `Fixed: ${fixed.length ? fixed.join(", ") : "not published"}`,
      `Severity: ${severity.source}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
    evidenceStatus: "verified",
    pkg,
    references,
  });
}

export function buildOutdatedFinding(pkg: DependencyPackage, latest: string): Finding {
  const projectUrl =
    pkg.ecosystem === "npm"
      ? `https://www.npmjs.com/package/${pkg.name}`
      : `https://pypi.org/project/${pkg.name}/`;

  return makeDependencyFinding({
    ruleId: "outdated",
    title: `Dependency update available: ${pkg.name} ${pkg.version} to ${latest}`,
    severity: "low",
    confidence: "medium",
    category: "maintainability",
    explanation: `The resolved version of ${pkg.name} is ${pkg.version}, while the registry publishes ${latest} as the latest release. This is a maintenance suggestion, not a vulnerability finding.`,
    whyProblematic:
      "Older releases may miss bug fixes, compatibility work, and security patches. A newer release can also contain breaking changes, so upgrade deliberately.",
    suggestedFix: `Review the ${pkg.name} release notes, upgrade to ${latest} if compatible, regenerate the lockfile, and run the project's tests. Saulify does not modify dependencies.`,
    evidence: [
      `Ecosystem: ${pkg.ecosystem}`,
      `Package: ${pkg.name}`,
      `Installed: ${pkg.version}`,
      `Latest: ${latest}`,
      `Manifest: ${pkg.manifest}`,
      `Declared range: ${pkg.declaredRange ?? "unknown"}`,
    ].join("\n"),
    evidenceStatus: "unverified",
    pkg,
    references: [projectUrl],
  });
}

export function buildUnusedFinding(pkg: DependencyPackage, coverage: number): Finding {
  return makeDependencyFinding({
    ruleId: "unused",
    title: `Possibly unused dependency: ${pkg.name}`,
    severity: "low",
    confidence: "low",
    category: "maintainability",
    explanation: `The direct runtime dependency ${pkg.name} is declared in package.json, but no import or package.json script reference was found across the ${coverage} analyzed source files. This is a suggestion only; dynamic loading, configuration files, or files outside the analysis sample may use it.`,
    whyProblematic:
      "Unused runtime dependencies add install size and supply-chain exposure. Removing a dependency that is loaded dynamically or referenced by tooling will break the project.",
    suggestedFix:
      "Verify the package is not required dynamically, by configuration, or by an entry point outside the analyzed files. If it is truly unused, remove it from package.json and regenerate the lockfile. Saulify does not modify dependencies.",
    evidence: [
      `Ecosystem: ${pkg.ecosystem}`,
      `Package: ${pkg.name}`,
      `Installed: ${pkg.version ?? "not resolved"}`,
      `Declared range: ${pkg.declaredRange ?? "unknown"}`,
      `Manifest: ${pkg.manifest}`,
      `Coverage: ${coverage}/${coverage} analyzable source files`,
    ].join("\n"),
    evidenceStatus: "unverified",
    pkg,
  });
}
