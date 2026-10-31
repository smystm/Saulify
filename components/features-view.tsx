"use client";

import Link from "next/link";
import { CAPABILITY_STYLES } from "@/components/capability-styles";
import { ArrowRightIcon, CheckIcon, ShieldIcon, SparkIcon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/components/language-provider";
import { openOnboarding } from "@/components/onboarding";

function twoDigits(locale: string, value: number) {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", {
    minimumIntegerDigits: 2,
    useGrouping: false,
  }).format(value);
}

function SecurityVisual() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e0c]/85 p-5 shadow-2xl shadow-black/50">
      <div className="absolute -end-16 -top-16 h-48 w-48 rounded-full bg-lime-400/10 blur-3xl" aria-hidden="true" />
      <div className="relative flex items-center justify-between">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-400/80" />
          <span className="h-2 w-2 rounded-full bg-amber-300/80" />
          <span className="h-2 w-2 rounded-full bg-lime-300/80" />
        </div>
        <span className="h-1.5 w-14 rounded-full bg-white/10" />
      </div>
      <div className="relative mt-5 space-y-2.5">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                row === 0
                  ? "border-rose-300/20 bg-rose-300/10 text-rose-300"
                  : "border-lime-300/15 bg-lime-300/[0.06] text-lime-300/70"
              }`}
            >
              <ShieldIcon className="h-4 w-4" />
            </span>
            <div className="flex-1 space-y-1.5">
              <span
                className={`block h-1.5 rounded-full ${
                  row === 0 ? "w-4/5 bg-rose-300/40" : "w-3/5 bg-white/15"
                }`}
              />
              <span className="block h-1 w-2/5 rounded-full bg-white/[0.07]" />
            </div>
            <span
              className={`h-5 w-10 rounded-full ${
                row === 0 ? "bg-rose-300/15" : "bg-white/[0.04]"
              }`}
            />
          </div>
        ))}
      </div>
      <div className="relative mt-4 flex items-center gap-2">
        <span className="h-1 flex-1 rounded-full bg-gradient-to-r from-lime-300 to-emerald-400" />
        <span className="grid h-5 w-5 place-items-center rounded-full border border-lime-300/25 text-lime-300">
          <CheckIcon className="h-2.5 w-2.5" />
        </span>
      </div>
    </div>
  );
}

function QualityVisual() {
  const metrics = [
    { width: "84%", accent: "from-cyan-300 to-sky-400" },
    { width: "46%", accent: "from-cyan-300/80 to-sky-400/80" },
    { width: "64%", accent: "from-sky-300 to-cyan-400" },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e0c]/85 p-5 shadow-2xl shadow-black/50">
      <div className="absolute -start-16 -bottom-16 h-48 w-48 rounded-full bg-cyan-400/10 blur-3xl" aria-hidden="true" />
      <div className="relative flex items-center justify-between">
        <span className="h-1.5 w-20 rounded-full bg-white/15" />
        <span className="h-5 w-12 rounded-full border border-white/10 bg-white/[0.03]" />
      </div>
      <div className="relative mt-6 space-y-5">
        {metrics.map((metric, row) => (
          <div key={row}>
            <div className="mb-2 flex items-center justify-between">
              <span className="h-1.5 w-24 rounded-full bg-white/15" />
              <span className="h-1.5 w-7 rounded-full bg-white/10" />
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${metric.accent}`}
                style={{ width: metric.width }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="relative mt-6 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((tile) => (
          <div
            key={tile}
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5"
          >
            <span className="block h-1 w-2/3 rounded-full bg-cyan-300/30" />
            <span className="mt-2 block h-1 w-1/2 rounded-full bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ArchitectureVisual() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e0c]/85 p-5 shadow-2xl shadow-black/50">
      <div className="absolute end-1/2 top-1/2 h-48 w-48 translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-400/10 blur-3xl" aria-hidden="true" />
      <div className="relative h-64">
        <svg
          className="absolute inset-0 h-full w-full text-violet-300/20"
          viewBox="0 0 320 240"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M72 62h70v52h100" />
          <path d="M142 114v64" />
          <path d="M142 178H60v-42" />
          <path d="M242 114v78" />
          <path d="M142 62V24h100" />
        </svg>
        <span className="absolute start-[8%] top-[14%] grid h-10 w-10 place-items-center rounded-xl border border-violet-300/25 bg-violet-300/10 text-violet-300">
          <span className="h-3 w-3 rounded border border-current" />
        </span>
        <span className="absolute start-[40%] top-[36%] grid h-12 w-12 place-items-center rounded-xl border border-violet-300/30 bg-violet-300/15 text-violet-200">
          <span className="h-4 w-4 rounded border border-current" />
        </span>
        <span className="absolute end-[10%] top-[36%] grid h-10 w-10 place-items-center rounded-xl border border-violet-300/20 bg-violet-300/[0.07] text-violet-300/80">
          <span className="h-3 w-3 rounded border border-current" />
        </span>
        <span className="absolute start-[10%] bottom-[10%] grid h-10 w-10 place-items-center rounded-xl border border-violet-300/20 bg-violet-300/[0.07] text-violet-300/80">
          <span className="h-3 w-3 rounded border border-current" />
        </span>
        <span className="absolute end-[8%] bottom-[6%] grid h-10 w-10 place-items-center rounded-xl border border-violet-300/25 bg-violet-300/10 text-violet-300">
          <span className="h-3 w-3 rounded border border-current" />
        </span>
        <span className="absolute end-[12%] top-[7%] h-2.5 w-2.5 rounded-full bg-violet-300/50" />
        <span className="absolute start-[44%] bottom-[8%] h-2 w-2 rounded-full bg-violet-300/40" />
      </div>
    </div>
  );
}

function InsightsVisual() {
  const rows = [
    { width: "88%", accent: "from-amber-300 to-orange-400" },
    { width: "62%", accent: "from-amber-300/80 to-orange-400/70" },
    { width: "74%", accent: "from-orange-300 to-amber-400" },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e0c]/85 p-5 shadow-2xl shadow-black/50">
      <div className="absolute start-1/2 top-0 h-40 w-40 -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto h-32 w-32">
        <span className="absolute inset-0 rounded-full border border-amber-300/15" />
        <span className="absolute inset-5 rounded-full border border-amber-300/20" />
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-amber-300/30 bg-amber-300/10 text-amber-300 shadow-lg shadow-amber-400/10">
            <SparkIcon className="h-6 w-6" />
          </span>
        </span>
        <span className="absolute start-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-amber-300/60" />
        <span className="absolute end-1 top-3 h-1.5 w-1.5 rounded-full bg-amber-300/40" />
        <span className="absolute bottom-1 end-6 h-2 w-2 rounded-full bg-orange-300/50" />
      </div>
      <div className="relative mt-5 space-y-3">
        {rows.map((row, index) => (
          <div
            key={index}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
          >
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded-md border border-amber-300/20 text-amber-300/80">
                <CheckIcon className="h-2.5 w-2.5" />
              </span>
              <span className="h-1.5 flex-1 rounded-full bg-white/15" />
            </div>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${row.accent}`}
                style={{ width: row.width }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CapabilityVisual({ index }: { index: number }) {
  return (
    <div aria-hidden="true">
      {index === 0 && <SecurityVisual />}
      {index === 1 && <QualityVisual />}
      {index === 2 && <ArchitectureVisual />}
      {index === 3 && <InsightsVisual />}
    </div>
  );
}

export function FeaturesView() {
  const { t, locale } = useI18n();

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-backdrop opacity-60" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-40 start-1/2 h-[34rem] w-[54rem] -translate-x-1/2 rounded-full bg-lime-400/[0.09] blur-[110px] rtl:translate-x-1/2" aria-hidden="true" />
      <div className="pointer-events-none absolute end-[-12rem] top-[38rem] h-80 w-80 rounded-full bg-cyan-400/[0.06] blur-[100px]" aria-hidden="true" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-white"
        >
          <span className="grid h-8 w-8 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300">
            <ShieldIcon className="h-4 w-4" />
          </span>
          Saulify
        </Link>
        <nav className="flex items-center gap-3 text-xs sm:gap-5">
          <span aria-current="page" className="hidden font-medium text-lime-200 sm:inline">
            {t.common.features}
          </span>
          <Link href="/#how-it-works" className="text-zinc-400 transition hover:text-white">
            {t.home.navHow}
          </Link>
          <span className="hidden rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-400 md:inline">
            {t.common.readOnly}
          </span>
          <LanguageSwitcher />
        </nav>
      </header>

      <main className="relative z-10">
        <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-12 text-center sm:px-8 sm:pb-20 sm:pt-20">
          <div className="animate-rise mx-auto flex max-w-3xl flex-col items-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] font-medium tracking-wide text-zinc-300">
              <SparkIcon className="h-3.5 w-3.5 text-lime-300" />
              {t.features.eyebrow}
            </div>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
              {t.features.title}
            </h1>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
              {t.features.description}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-lime-300 px-5 py-3 text-sm font-semibold text-[#10150d] transition hover:bg-lime-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
              >
                {t.features.cta.action}
                <ArrowRightIcon className="h-4 w-4 rtl:rotate-180" />
              </Link>
              <button
                type="button"
                onClick={openOnboarding}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
              >
                <SparkIcon className="h-4 w-4 text-lime-300" />
                {t.features.replay}
              </button>
            </div>
          </div>

          <div className="animate-rise-delay mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-2 sm:mt-14 sm:grid-cols-4">
            {t.features.capabilities.map((capability, index) => {
              const { Icon, iconBox } = CAPABILITY_STYLES[index];
              return (
                <a
                  key={capability.title}
                  href={`#capability-${index}`}
                  className="group flex flex-col items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center transition hover:border-white/15 hover:bg-white/[0.045]"
                >
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-lg border transition group-hover:scale-105 ${iconBox}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-[11px] font-medium leading-4 text-zinc-400 transition group-hover:text-zinc-200">
                    {capability.title}
                  </span>
                </a>
              );
            })}
          </div>
        </section>

        {t.features.capabilities.map((capability, index) => {
          const { Icon, iconBox, glow, bar } = CAPABILITY_STYLES[index];
          const titleId = `capability-${index}-title`;
          return (
            <section
              key={capability.title}
              id={`capability-${index}`}
              aria-labelledby={titleId}
              className="border-t border-white/[0.06] scroll-mt-8"
            >
              <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-24">
                <div className={index % 2 === 1 ? "lg:order-2" : ""}>
                  <div className="flex items-center gap-3">
                    <span className={`grid h-12 w-12 place-items-center rounded-xl border ${iconBox}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="font-mono text-xs tracking-[0.3em] text-zinc-600">
                      {twoDigits(locale, index + 1)}
                    </span>
                  </div>
                  <h2
                    id={titleId}
                    className="mt-6 text-2xl font-semibold tracking-tight text-white sm:text-3xl"
                  >
                    {capability.title}
                  </h2>
                  <p className="mt-4 max-w-lg text-sm leading-7 text-zinc-400">
                    {capability.description}
                  </p>
                  <ul className="mt-6 space-y-3">
                    {capability.points.map((point) => (
                      <li key={point} className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
                        <span
                          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${iconBox}`}
                        >
                          <CheckIcon className="h-2.5 w-2.5" />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                  <span className={`mt-8 block h-0.5 w-16 rounded-full bg-gradient-to-r ${bar}`} />
                  <span
                    className={`pointer-events-none -mt-24 ms-10 block h-24 w-24 rounded-full blur-3xl ${glow}`}
                    aria-hidden="true"
                  />
                </div>
                <div className={index % 2 === 1 ? "lg:order-1" : ""}>
                  <CapabilityVisual index={index} />
                </div>
              </div>
            </section>
          );
        })}

        <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-4 sm:px-8">
          <div className="relative overflow-hidden rounded-3xl border border-lime-300/20 bg-gradient-to-br from-lime-300/[0.08] via-white/[0.02] to-cyan-400/[0.06] px-6 py-12 text-center sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute start-1/2 top-0 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-lime-400/10 blur-3xl rtl:translate-x-1/2" aria-hidden="true" />
            <h2 className="relative text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {t.features.cta.title}
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-sm leading-7 text-zinc-400">
              {t.features.cta.description}
            </p>
            <Link
              href="/"
              className="relative mt-7 inline-flex items-center justify-center gap-2 rounded-xl bg-lime-300 px-5 py-3 text-sm font-semibold text-[#10150d] transition hover:bg-lime-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
            >
              {t.features.cta.action}
              <ArrowRightIcon className="h-4 w-4 rtl:rotate-180" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-3 px-5 py-8 text-[11px] text-zinc-600 sm:flex-row sm:items-center sm:px-8">
          <p>{t.report.footerLeft}</p>
          <p>{t.report.footerRight}</p>
        </div>
      </footer>
    </div>
  );
}
