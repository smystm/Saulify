"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseGitHubRepoUrl } from "@/lib/github/url";
import { reportSchema, type Report } from "@/lib/reports/schema";
import { ArrowRightIcon, AlertIcon, FileCodeIcon, GitHubIcon, ShieldIcon, SparkIcon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/components/language-provider";
import type { Dictionary, Locale } from "@/lib/i18n";

const EXAMPLES = [
  { label: "expressjs/express", url: "https://github.com/expressjs/express" },
  { label: "pallets/flask", url: "https://github.com/pallets/flask" },
  { label: "sindresorhus/got", url: "https://github.com/sindresorhus/got" },
];

type FormError =
  | { kind: "url"; message?: string }
  | { kind: "api"; code?: string; message?: string }
  | { kind: "unreadable" }
  | { kind: "failed" }
  | { kind: "invalidReport" }
  | { kind: "timeout" }
  | { kind: "quota" };

function errorText(error: FormError, locale: Locale, t: Dictionary): string {
  if (error.kind === "url") {
    return locale === "en" && error.message ? error.message : t.home.errors.invalidUrl;
  }
  if (error.kind === "api") {
    return t.home.apiErrors[error.code ?? ""] ?? (locale === "en" && error.message ? error.message : t.home.errors.failed);
  }
  if (error.kind === "unreadable") return t.home.errors.unreadable;
  if (error.kind === "invalidReport") return t.home.errors.invalidReport;
  if (error.kind === "timeout") return t.home.errors.timeout;
  if (error.kind === "quota") return t.home.errors.quota;
  return t.home.errors.failed;
}

function readApiError(payload: unknown): { code?: string; message?: string } {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return {};
  const error = payload.error;
  if (!error || typeof error !== "object") return {};
  return {
    code: "code" in error && typeof error.code === "string" ? error.code : undefined,
    message: "message" in error && typeof error.message === "string" ? error.message : undefined,
  };
}

function storageKey(id: string) {
  return `saulify:report:${id}`;
}

export function AnalyzeForm() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<FormError | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function stopTimer() {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);

    let canonicalUrl: string;
    try {
      canonicalUrl = parseGitHubRepoUrl(url).canonicalUrl;
    } catch (validationError) {
      setError({
        kind: "url",
        message: validationError instanceof Error ? validationError.message : undefined,
      });
      return;
    }

    setUrl(canonicalUrl);
    setLoading(true);
    setProgress(6);
    setStep(0);
    stopTimer();
    timer.current = setInterval(() => {
      setStep((current) => Math.min(current + 1, t.home.steps.length - 1));
      setProgress((value) => Math.min(90, value + 16));
    }, 2_300);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: canonicalUrl }),
        signal: AbortSignal.timeout(65_000),
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        stopTimer();
        setError({ kind: "unreadable" });
        setLoading(false);
        return;
      }

      if (!response.ok) {
        stopTimer();
        setError({ kind: "api", ...readApiError(payload) });
        setLoading(false);
        return;
      }

      const parsed = reportSchema.safeParse(payload);
      if (!parsed.success) {
        stopTimer();
        setError({ kind: "invalidReport" });
        setLoading(false);
        return;
      }

      const report: Report = parsed.data;
      sessionStorage.setItem(storageKey(report.id), JSON.stringify(report));
      setProgress(100);
      setStep(t.home.steps.length - 1);
      stopTimer();
      router.push(`/reports/${report.id}`);
    } catch (requestError) {
      stopTimer();
      if (
        requestError instanceof Error &&
        (requestError.name === "TimeoutError" || requestError.name === "AbortError")
      ) {
        setError({ kind: "timeout" });
      } else if (requestError instanceof DOMException && requestError.name === "QuotaExceededError") {
        setError({ kind: "quota" });
      } else {
        setError({ kind: "failed" });
      }
      setLoading(false);
    }
  }

  const progressText = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(progress);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-backdrop opacity-60" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[54rem] -translate-x-1/2 rounded-full bg-lime-400/[0.09] blur-[110px]" aria-hidden="true" />
      <div className="pointer-events-none absolute end-[-12rem] top-[28rem] h-80 w-80 rounded-full bg-cyan-400/[0.06] blur-[100px]" aria-hidden="true" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white">
          <span className="grid h-8 w-8 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300">
            <ShieldIcon className="h-4 w-4" />
          </span>
          Saulify
        </Link>
        <nav className="flex items-center gap-3 text-xs text-zinc-400 sm:gap-5">
          <a className="hidden transition hover:text-white sm:block" href="#how-it-works">
            {t.home.navHow}
          </a>
          <a className="hidden transition hover:text-white sm:block" href="#limits">
            {t.home.navLimits}
          </a>
          <span className="hidden rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-400 md:inline">
            {t.common.readOnly}
          </span>
          <LanguageSwitcher />
        </nav>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-5 pb-20 pt-12 sm:px-8 sm:pt-20">
        <div className="animate-rise flex flex-col items-center text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] font-medium tracking-wide text-zinc-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-300 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime-300" />
            </span>
            {t.home.badge}
          </div>

          <h1 className="max-w-4xl text-4xl font-semibold leading-[1.06] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
            {t.home.heroLine1}
            <span className="block text-gradient">{t.home.heroLine2}</span>
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-7 text-zinc-400 sm:text-base">{t.home.heroDescription}</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="animate-rise-delay relative z-10 mt-10 w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0c0f0d]/90 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl"
          aria-busy={loading}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-transparent bg-white/[0.035] px-4 py-3.5 transition focus-within:border-lime-300/30 focus-within:bg-white/[0.05]">
              <GitHubIcon className="h-5 w-5 shrink-0 text-zinc-500 transition group-focus-within:text-zinc-300" />
              <span className="sr-only">{t.home.formLabel}</span>
              <input
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (error) setError(null);
                }}
                disabled={loading}
                placeholder={t.home.placeholder}
                autoComplete="url"
                spellCheck={false}
                dir="ltr"
                className="min-w-0 flex-1 bg-transparent text-left font-mono text-sm text-white outline-none placeholder:text-zinc-600 disabled:opacity-60"
              />
            </label>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-lime-300 px-5 py-3.5 text-sm font-semibold text-[#10150d] transition hover:bg-lime-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#10150d]/30 border-t-[#10150d]" />
                  {t.home.analyzing}
                </>
              ) : (
                <>
                  {t.home.analyze}
                  <ArrowRightIcon className="h-4 w-4 rtl:rotate-180" />
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mx-1 mt-2 flex gap-2.5 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-start text-xs leading-5 text-red-200" role="alert">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>{errorText(error, locale, t)}</span>
            </div>
          )}

          {loading && (
            <div className="mx-1 mt-2 rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3.5" aria-live="polite">
              <div className="mb-2.5 flex items-center justify-between gap-4 text-[11px]">
                <span className="flex items-center gap-2 text-zinc-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-lime-300" />
                  {t.home.steps[step]}
                </span>
                <span className="font-mono text-zinc-600" dir="ltr">{progressText}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-lime-300 to-emerald-400 transition-all duration-700 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2.5 text-[10px] leading-4 text-zinc-600">{t.home.progressNote}</p>
            </div>
          )}
        </form>

        {!loading && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-600">
            <span>{t.home.try}</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.url}
                type="button"
                dir="ltr"
                onClick={() => {
                  setUrl(example.url);
                  setError(null);
                }}
                className="rounded-full border border-white/[0.07] px-2.5 py-1 font-mono text-zinc-400 transition hover:border-lime-300/25 hover:text-lime-200"
              >
                {example.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-2 sm:grid-cols-3">
          {t.home.trust.map((item, index) => {
            const Icon = [ShieldIcon, FileCodeIcon, SparkIcon][index];
            return (
              <div key={item.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-start">
                <Icon className="mb-2.5 h-4 w-4 text-lime-300/80" />
                <div className="text-xs font-medium text-zinc-200">{item.title}</div>
                <p className="mt-1 text-[11px] leading-5 text-zinc-500">{item.copy}</p>
              </div>
            );
          })}
        </div>
      </main>

      <section id="how-it-works" className="relative z-10 border-t border-white/[0.06] bg-black/20">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:py-20">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-lime-300/70">{t.home.how.eyebrow}</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t.home.how.title}</h2>
            <p className="mt-4 max-w-md text-sm leading-7 text-zinc-500">{t.home.how.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {t.home.how.cards.map(([number, title, copy]) => (
              <div key={number} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
                <span className="font-mono text-[10px] text-lime-300/60" dir="ltr">{number}</span>
                <h3 className="mt-4 text-sm font-medium text-zinc-100">{title}</h3>
                <p className="mt-2 text-[11px] leading-5 text-zinc-500">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="limits" className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-5 px-5 py-8 text-[11px] text-zinc-600 sm:flex-row sm:items-center sm:px-8">
          <p>{t.home.limits.size}</p>
          <p>{t.home.limits.safety}</p>
        </div>
      </section>
    </div>
  );
}
