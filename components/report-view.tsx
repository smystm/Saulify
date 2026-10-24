"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Finding, Report, Severity } from "@/lib/reports/schema";
import { CopyButton } from "@/components/copy-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/components/language-provider";
import {
  AlertIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  GitHubIcon,
  ShieldIcon,
  SparkIcon,
} from "@/components/icons";
import type { Locale } from "@/lib/i18n";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "border-red-400/25 bg-red-400/10 text-red-300",
  high: "border-orange-400/25 bg-orange-400/10 text-orange-300",
  medium: "border-amber-300/25 bg-amber-300/10 text-amber-200",
  low: "border-sky-400/25 bg-sky-400/10 text-sky-300",
};

const CONFIDENCE_STYLES = {
  high: "text-emerald-300",
  medium: "text-amber-200",
  low: "text-zinc-400",
} as const;

function numberFormat(locale: Locale, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", options);
}

function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return numberFormat(locale, options).format(value);
}

function formatDuration(milliseconds: number, locale: Locale): string {
  if (milliseconds < 1_000) return `${formatNumber(milliseconds, locale)}ms`;
  return `${formatNumber(milliseconds / 1_000, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;
}

function formatDate(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleString(locale === "fa" ? "fa-IR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function FindingCard({ finding, issuesUrl }: { finding: Finding; issuesUrl: string }) {
  const { t } = useI18n();
  const location = finding.file
    ? `${finding.file}${finding.startLine ? `:${finding.startLine}${finding.endLine && finding.endLine !== finding.startLine ? `–${finding.endLine}` : ""}` : ""}`
    : t.report.finding.repositoryWide;

  return (
    <article
      id={finding.id}
      className="finding-card overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0e0c]/80"
    >
      <div className="border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${SEVERITY_STYLES[finding.severity]}`}
          >
            {t.report.severities[finding.severity]}
          </span>
          <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-zinc-400">
            {t.report.categories[finding.category]}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
            <span className={`h-1.5 w-1.5 rounded-full ${finding.source === "ai" ? "bg-violet-300" : "bg-lime-300"}`} />
            {t.report.source[finding.source]}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              finding.evidenceStatus === "verified"
                ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-200"
                : "border-white/10 bg-white/[0.03] text-zinc-400"
            }`}
          >
            {t.report.evidenceStatus[finding.evidenceStatus]}
          </span>
        </div>
        <h2 dir="ltr" className="text-left text-base font-semibold leading-6 tracking-tight text-zinc-100 sm:text-lg">
          {finding.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span dir="ltr" className="text-left font-mono text-lime-200/80">{location}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">
            {t.report.confidence.label}{" "}
            <span className={CONFIDENCE_STYLES[finding.confidence]}>{t.report.confidence[finding.confidence]}</span>
          </span>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {t.report.finding.what}
          </h3>
          <p dir="ltr" className="text-left text-sm leading-6 text-zinc-300">{finding.explanation}</p>
        </div>

        {finding.evidence && (
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              {t.report.finding.evidence}
            </h3>
            <pre
              dir="ltr"
              className="max-h-56 overflow-auto rounded-xl border border-white/[0.07] bg-black/40 p-3 text-left font-mono text-[11px] leading-5 text-zinc-300"
            >
              <code>{finding.evidence}</code>
            </pre>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              {t.report.finding.why}
            </h3>
            <p dir="ltr" className="text-left text-xs leading-6 text-zinc-400">{finding.whyProblematic}</p>
          </div>
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              {t.report.finding.suggested}
            </h3>
            <p dir="ltr" className="text-left text-xs leading-6 text-zinc-400">{finding.suggestedFix}</p>
          </div>
        </div>

        <details className="group rounded-xl border border-white/[0.07] bg-white/[0.02]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-xs font-medium text-zinc-300 transition hover:text-white">
            <span className="flex items-center gap-2">
              <GitHubIcon className="h-3.5 w-3.5 text-zinc-500" />
              {t.report.finding.draft}
            </span>
            <ChevronDownIcon className="h-4 w-4 text-zinc-600 transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-white/[0.06] px-3.5 py-3.5">
            <div className="mb-2 flex flex-wrap gap-2">
              <CopyButton text={finding.issue.title} label={t.report.finding.copyTitle} copiedLabel={t.common.copied} />
              <CopyButton
                text={finding.issue.body}
                label={t.report.finding.copyDescription}
                copiedLabel={t.common.copied}
              />
              <a
                href={issuesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              >
                {t.report.finding.openIssues}
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            </div>
            <p dir="ltr" className="mb-1 mt-3 text-left text-[11px] font-medium text-zinc-300">{finding.issue.title}</p>
            <pre
              dir="ltr"
              className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-left font-mono text-[10px] leading-5 text-zinc-400"
            >
              {finding.issue.body}
            </pre>
          </div>
        </details>
      </div>
    </article>
  );
}

export function ReportView({ report }: { report: Report }) {
  const { locale, t } = useI18n();
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const counts = useMemo(() => {
    const base: Record<Severity | "all", number> = { all: report.findings.length, critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of report.findings) base[finding.severity]++;
    return base;
  }, [report.findings]);

  const verifiedCount = report.findings.filter((finding) => finding.evidenceStatus === "verified").length;
  const hypothesisCount = report.findings.length - verifiedCount;

  const visible = report.findings.filter(
    (finding) => (severity === "all" || finding.severity === severity) && (!verifiedOnly || finding.evidenceStatus === "verified"),
  );

  const localizedSummary = t.report.summary({
    total: formatNumber(report.findings.length, locale),
    files: formatNumber(report.stats.filesAnalyzed, locale),
    critical: formatNumber(counts.critical, locale),
    high: formatNumber(counts.high, locale),
    medium: formatNumber(counts.medium, locale),
    low: formatNumber(counts.low, locale),
    verified: formatNumber(verifiedCount, locale),
    hypotheses: formatNumber(hypothesisCount, locale),
    ai: report.mode.ai,
  });

  const aiFailureReason = report.warnings
    .find((warning) => warning.startsWith("AI review failed: ") || warning.startsWith("AI output was rejected: "))
    ?.replace(/^AI (?:review failed|output was rejected): /, "");

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070908]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-gradient-to-b from-lime-300/[0.055] to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 grid-backdrop opacity-30" aria-hidden="true" />

      <header className="relative z-20 border-b border-white/[0.07] bg-[#070908]/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white">
            <span className="grid h-8 w-8 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300">
              <ShieldIcon className="h-4 w-4" />
            </span>
            Saulify
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <a
              href={report.repo.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-white/[0.04] hover:text-white sm:inline-flex"
            >
              {t.common.repository}
              <ExternalLinkIcon className="h-3.5 w-3.5" />
            </a>
            <a
              href={report.repo.issuesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
            >
              <GitHubIcon className="h-3.5 w-3.5" />
              {t.common.issues}
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
            <Link
              href="/"
              className="rounded-lg bg-lime-300 px-3 py-1.5 text-xs font-semibold text-[#10150d] transition hover:bg-lime-200"
            >
              {t.common.newAnalysis}
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <div className="flex flex-col justify-between gap-6 border-b border-white/[0.07] pb-8 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <p className="mb-3 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              <span className="h-1 w-1 rounded-full bg-lime-300" />
              {t.report.eyebrow}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 dir="ltr" className="break-all text-left text-2xl font-semibold tracking-tight text-white sm:text-4xl">
                {report.repo.fullName}
              </h1>
              {report.repo.archived && (
                <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2 py-0.5 text-[10px] text-amber-200">
                  {t.report.archived}
                </span>
              )}
            </div>
            {report.repo.description && (
              <p dir="auto" className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{report.repo.description}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                <span dir="ltr" className="font-mono">{report.repo.defaultBranch}</span>
              </span>
              <span>★ {formatNumber(report.repo.stars, locale)}</span>
              <span>{t.report.forks(formatNumber(report.repo.forks, locale))}</span>
              {report.repo.license && <span dir="ltr" className="font-mono">{report.repo.license}</span>}
              <span>{t.report.analysisTime(formatDuration(report.stats.durationMs, locale))}</span>
              <span>{formatDate(report.generatedAt, locale)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {report.languages.map((language) => (
              <span
                key={language.name}
                className="rounded-full border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 text-[10px] text-zinc-400"
              >
                <span dir="ltr">{language.name}</span>{" "}
                <span className="text-zinc-600">{formatNumber(language.percentage, locale)}%</span>
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-start">
          <div
            className={`flex flex-1 gap-3 rounded-xl border px-4 py-3 text-xs leading-5 ${
              report.mode.ai
                ? "border-emerald-300/15 bg-emerald-300/[0.04] text-emerald-100/80"
                : "border-amber-300/15 bg-amber-300/[0.035] text-amber-100/70"
            }`}
          >
            {report.mode.ai ? (
              <SparkIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            ) : (
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            )}
            <div>
              <span className="font-medium text-zinc-200">
                {report.mode.ai ? t.report.mode.ai : t.report.mode.static}
              </span>
              {report.mode.model && (
                <span dir="ltr" className="ms-2 font-mono text-[10px] text-zinc-500">
                  {report.mode.provider} / {report.mode.model}
                  {!report.mode.ai && <span className="ms-1 text-zinc-600">({t.report.mode.notUsed})</span>}
                </span>
              )}
              <p className="mt-0.5 text-zinc-500">
                {report.mode.ai
                  ? locale === "en"
                    ? report.mode.note
                    : null
                  : aiFailureReason
                    ? t.report.mode.failure(aiFailureReason)
                    : t.report.mode.staticNote}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600">{t.report.files}</div>
              <div className="mt-0.5 font-mono text-sm text-zinc-200" dir="ltr">
                {formatNumber(report.stats.filesAnalyzed, locale)}
                <span className="text-zinc-600">/{formatNumber(report.stats.filesSelected, locale)}</span>
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600">{t.report.evidence}</div>
              <div className="mt-0.5 font-mono text-sm text-zinc-200" dir="ltr">
                {formatNumber(verifiedCount, locale)}
                <span className="text-zinc-600">/{formatNumber(report.findings.length, locale)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">{t.report.reviewSummary}</h2>
                  <p className="mt-2 max-w-2xl text-xs leading-6 text-zinc-400">{localizedSummary}</p>
                  {locale === "fa" && (
                    <p dir="auto" className="mt-2 max-w-2xl text-[10px] leading-5 text-zinc-600">
                      {t.report.technicalNote}
                    </p>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {SEVERITY_ORDER.map((level) => (
                    <div
                      key={level}
                      className="min-w-12 rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1.5 text-center"
                    >
                      <div className={`text-sm font-semibold ${level === "critical" ? "text-red-300" : level === "high" ? "text-orange-300" : level === "medium" ? "text-amber-200" : "text-sky-300"}`}>
                        {formatNumber(counts[level], locale)}
                      </div>
                      <div className="text-[8px] uppercase tracking-wider text-zinc-600">{t.report.severities[level]}</div>
                    </div>
                  ))}
                </div>
              </div>
              {report.findings.length > 0 && (
                <p className="mt-4 border-t border-white/[0.06] pt-3 text-[10px] leading-5 text-zinc-600">
                  {t.report.evidenceLine(
                    formatNumber(verifiedCount, locale),
                    formatNumber(hypothesisCount, locale),
                  )}
                </p>
              )}
            </div>

            {report.warnings.length > 0 && (
              <details className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02]">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[11px] font-medium text-zinc-400">
                  <span className="flex items-center gap-2">
                    <AlertIcon className="h-3.5 w-3.5 text-amber-300/70" />
                    {t.report.warnings(formatNumber(report.warnings.length, locale))}
                  </span>
                  <ChevronDownIcon className="h-3.5 w-3.5 text-zinc-600" />
                </summary>
                <ul className="space-y-1.5 border-t border-white/[0.06] px-4 py-3 text-[11px] leading-5 text-zinc-500">
                  {report.warnings.map((warning, index) => (
                    <li key={index} dir="ltr" className="flex gap-2 text-left">
                      <span className="text-zinc-700">–</span>
                      {warning}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="sticky top-0 z-10 -mx-1 mt-7 bg-[#070908]/90 px-1 py-3 backdrop-blur-xl">
              <div className="flex flex-wrap items-center gap-1.5">
                {(["all", ...SEVERITY_ORDER] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setSeverity(level)}
                    aria-pressed={severity === level}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                      severity === level
                        ? "border-lime-300/30 bg-lime-300/[0.12] text-lime-200"
                        : "border-white/[0.07] bg-white/[0.02] text-zinc-500 hover:border-white/15 hover:text-zinc-300"
                    }`}
                  >
                    {t.report.filters[level]}{" "}
                    <span className="ms-0.5 opacity-60">{formatNumber(counts[level], locale)}</span>
                  </button>
                ))}
                {hypothesisCount > 0 && (
                  <label className="ms-auto flex cursor-pointer items-center gap-2 text-[11px] text-zinc-500">
                    <input
                      type="checkbox"
                      checked={verifiedOnly}
                      onChange={(event) => setVerifiedOnly(event.target.checked)}
                      className="h-3.5 w-3.5 accent-lime-300"
                    />
                    {t.report.filters.verifiedOnly}
                  </label>
                )}
              </div>
            </div>

            <div className="mt-2 space-y-3">
              {visible.length > 0 ? (
                visible.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} issuesUrl={report.repo.issuesUrl} />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center">
                  <FileCodeIcon className="mx-auto h-6 w-6 text-zinc-700" />
                  <h3 className="mt-3 text-sm font-medium text-zinc-300">
                    {report.findings.length === 0 ? t.report.noIssues : t.report.noMatches}
                  </h3>
                  <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-zinc-600">
                    {report.findings.length === 0 ? t.report.noIssuesDescription : t.report.noMatchesDescription}
                  </p>
                  {(severity !== "all" || verifiedOnly) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSeverity("all");
                        setVerifiedOnly(false);
                      }}
                      className="mt-4 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition hover:text-white"
                    >
                      {t.report.clearFilters}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-lime-300/15 bg-lime-300/[0.035] p-4">
              <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
                <GitHubIcon className="h-3.5 w-3.5 text-lime-300" />
                {t.report.submit.title}
              </h2>
              <ol className="mt-3 space-y-3 text-[11px] leading-5 text-zinc-400">
                <li className="flex gap-2.5">
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-lime-300/25 font-mono text-[9px] text-lime-200">{formatNumber(1, locale)}</span>
                  <span>
                    {t.report.submit.step1Prefix}{" "}
                    <span className="font-medium text-zinc-200">{t.report.submit.step1Action}</span>
                    {t.report.submit.step1Suffix}
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-lime-300/25 font-mono text-[9px] text-lime-200">{formatNumber(2, locale)}</span>
                  {t.report.submit.step2}
                </li>
                <li className="flex gap-2.5">
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-lime-300/25 font-mono text-[9px] text-lime-200">{formatNumber(3, locale)}</span>
                  {t.report.submit.step3}
                </li>
                <li className="flex gap-2.5">
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-lime-300/25 font-mono text-[9px] text-lime-200">{formatNumber(4, locale)}</span>
                  {t.report.submit.step4}
                </li>
              </ol>
              <a
                href={report.repo.issuesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-lime-300/25 bg-lime-300/[0.08] px-3 py-2 text-[11px] font-medium text-lime-200 transition hover:bg-lime-300/[0.14]"
              >
                {t.report.submit.open}
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            </div>

            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{t.report.coverage.title}</h2>
              <dl className="mt-3 space-y-2 text-[11px]">
                {[
                  [t.report.coverage.treeEntries, formatNumber(report.stats.treeEntries, locale)],
                  [t.report.coverage.filesSelected, formatNumber(report.stats.filesSelected, locale)],
                  [t.report.coverage.filesAnalyzed, formatNumber(report.stats.filesAnalyzed, locale)],
                  [t.report.coverage.treeTruncated, report.stats.treeTruncated ? t.report.coverage.yes : t.report.coverage.no],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <dt className="text-zinc-600">{label}</dt>
                    <dd className="font-mono text-zinc-300">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-2xl border border-white/[0.07] p-4">
              <p className="text-[10px] leading-5 text-zinc-600">{t.report.disclaimer}</p>
            </div>
          </aside>
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-2 px-5 py-6 text-[10px] text-zinc-600 sm:flex-row sm:px-8">
          <span>{t.report.footerLeft}</span>
          <span>{t.report.footerRight}</span>
        </div>
      </footer>
    </div>
  );
}
