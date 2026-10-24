"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseGitHubRepoUrl } from "@/lib/github/url";
import { reportSchema, type Report } from "@/lib/reports/schema";
import { ArrowRightIcon, AlertIcon, FileCodeIcon, GitHubIcon, ShieldIcon, SparkIcon } from "@/components/icons";

const STEPS = [
  "Validating repository",
  "Reading the source tree",
  "Running static rules",
  "Checking for AI-reviewed issues",
  "Validating and packaging report",
];

const EXAMPLES = [
  { label: "expressjs/express", url: "https://github.com/expressjs/express" },
  { label: "pallets/flask", url: "https://github.com/pallets/flask" },
  { label: "sindresorhus/got", url: "https://github.com/sindresorhus/got" },
];

function storageKey(id: string) {
  return `saulify:report:${id}`;
}

export function AnalyzeForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
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
      setError(validationError instanceof Error ? validationError.message : "Enter a valid GitHub repository URL.");
      return;
    }

    setUrl(canonicalUrl);
    setLoading(true);
    setProgress(6);
    setStep(0);
    stopTimer();
    timer.current = setInterval(() => {
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
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
        throw new Error("The server returned an unreadable response. Please try again.");
      }

      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          payload.error &&
          typeof payload.error === "object" &&
          "message" in payload.error &&
          typeof payload.error.message === "string"
            ? payload.error.message
            : "Analysis failed. Please try again.";
        throw new Error(message);
      }

      const parsed = reportSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("The server returned an invalid report. Please try again.");
      }

      const report: Report = parsed.data;
      sessionStorage.setItem(storageKey(report.id), JSON.stringify(report));
      setProgress(100);
      setStep(STEPS.length - 1);
      stopTimer();
      router.push(`/reports/${report.id}`);
    } catch (requestError) {
      stopTimer();
      if (
        requestError instanceof Error &&
        (requestError.name === "TimeoutError" || requestError.name === "AbortError")
      ) {
        setError("The analysis took too long and was stopped. Try a smaller repository or try again.");
      } else if (requestError instanceof DOMException && requestError.name === "QuotaExceededError") {
        setError("The report is too large to store in this browser session. Please try again.");
      } else {
        setError(requestError instanceof Error ? requestError.message : "Analysis failed. Please try again.");
      }
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-backdrop opacity-60" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[54rem] -translate-x-1/2 rounded-full bg-lime-400/[0.09] blur-[110px]" aria-hidden="true" />
      <div className="pointer-events-none absolute right-[-12rem] top-[28rem] h-80 w-80 rounded-full bg-cyan-400/[0.06] blur-[100px]" aria-hidden="true" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white">
          <span className="grid h-8 w-8 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300">
            <ShieldIcon className="h-4 w-4" />
          </span>
          Saulify
        </Link>
        <nav className="flex items-center gap-5 text-xs text-zinc-400">
          <a className="hidden transition hover:text-white sm:block" href="#how-it-works">
            How it works
          </a>
          <a className="hidden transition hover:text-white sm:block" href="#limits">
            Limits
          </a>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-400">
            Read-only analyzer
          </span>
        </nav>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-5 pb-20 pt-12 sm:px-8 sm:pt-20">
        <div className="animate-rise flex flex-col items-center text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] font-medium tracking-wide text-zinc-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-300 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime-300" />
            </span>
            EVIDENCE-FIRST REPOSITORY REVIEW
          </div>

          <h1 className="max-w-4xl text-4xl font-semibold leading-[1.06] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
            Find what the last commit
            <span className="block text-gradient">missed.</span>
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-7 text-zinc-400 sm:text-base">
            Paste a public GitHub repository. Saulify reads selected source files, runs deterministic rules,
            and asks an optional AI reviewer to surface potential issues — with evidence you can inspect.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="animate-rise-delay relative z-10 mt-10 w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0c0f0d]/90 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl"
          aria-busy={loading}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-transparent bg-white/[0.035] px-4 py-3.5 transition focus-within:border-lime-300/30 focus-within:bg-white/[0.05]">
              <GitHubIcon className="h-5 w-5 shrink-0 text-zinc-500 transition group-focus-within:text-zinc-300" />
              <span className="sr-only">GitHub repository URL</span>
              <input
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (error) setError(null);
                }}
                disabled={loading}
                placeholder="https://github.com/owner/repository"
                autoComplete="url"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent font-mono text-sm text-white outline-none placeholder:text-zinc-600 disabled:opacity-60"
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
                  Analyzing
                </>
              ) : (
                <>
                  Analyze repo
                  <ArrowRightIcon className="h-4 w-4" />
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mx-1 mt-2 flex gap-2.5 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-left text-xs leading-5 text-red-200" role="alert">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className="mx-1 mt-2 rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3.5" aria-live="polite">
              <div className="mb-2.5 flex items-center justify-between gap-4 text-[11px]">
                <span className="flex items-center gap-2 text-zinc-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-lime-300" />
                  {STEPS[step]}
                </span>
                <span className="font-mono text-zinc-600">{progress}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-lime-300 to-emerald-400 transition-all duration-700 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2.5 text-[10px] leading-4 text-zinc-600">
                Public repository data only. Larger repositories and AI review can take up to a minute.
              </p>
            </div>
          )}
        </form>

        {!loading && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-600">
            <span>Try</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.url}
                type="button"
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
          {[
            { icon: ShieldIcon, title: "No code execution", copy: "Source is fetched read-only. Scripts and build hooks never run." },
            { icon: FileCodeIcon, title: "Evidence attached", copy: "Every finding carries a file, line, and inspectable snippet." },
            { icon: SparkIcon, title: "AI is optional", copy: "Static rules work without keys. AI adds validated hypotheses." },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left">
              <item.icon className="mb-2.5 h-4 w-4 text-lime-300/80" />
              <div className="text-xs font-medium text-zinc-200">{item.title}</div>
              <p className="mt-1 text-[11px] leading-5 text-zinc-500">{item.copy}</p>
            </div>
          ))}
        </div>
      </main>

      <section id="how-it-works" className="relative z-10 border-t border-white/[0.06] bg-black/20">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:py-20">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-lime-300/70">How it works</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              A small pipeline with a narrow job.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-7 text-zinc-500">
              Saulify is intentionally not an autonomous fixer. It produces review candidates and ready-to-copy
              issue drafts. A human decides what happens next.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["01", "Read", "Validated GitHub URL, repository metadata, default branch, and a capped subset of source files."],
              ["02", "Inspect", "Pattern rules and optional AI review look for risky code shapes, not runtime behavior."],
              ["03", "Report", "Findings are schema-validated, deduplicated, and paired with manual submission instructions."],
            ].map(([number, title, copy]) => (
              <div key={number} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
                <span className="font-mono text-[10px] text-lime-300/60">{number}</span>
                <h3 className="mt-4 text-sm font-medium text-zinc-100">{title}</h3>
                <p className="mt-2 text-[11px] leading-5 text-zinc-500">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="limits" className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-5 px-5 py-8 text-[11px] text-zinc-600 sm:flex-row sm:items-center sm:px-8">
          <p>
            Public repos only. Up to 250 MB source size, 20 selected files, and 5 analyses per 10 minutes per instance.
          </p>
          <p>Saulify never creates issues, commits files, or opens pull requests.</p>
        </div>
      </section>
    </div>
  );
}
