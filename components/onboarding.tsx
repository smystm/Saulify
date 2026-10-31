"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightIcon } from "@/components/icons";
import { CAPABILITY_STYLES } from "@/components/capability-styles";
import { useI18n } from "@/components/language-provider";

const OPEN_EVENT = "saulify:open-onboarding";

export function openOnboarding() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function localizedNumber(locale: string, value: number) {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", {
    useGrouping: false,
  }).format(value);
}

export function Onboarding() {
  const { t, locale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const capabilities = t.features.capabilities;
  const total = capabilities.length;
  const safeIndex = Math.min(index, total - 1);
  const capability = capabilities[safeIndex];
  const { Icon, iconBox, glow, bar } = CAPABILITY_STYLES[safeIndex];
  const isLast = safeIndex === total - 1;
  const progress = t.onboarding.progress(localizedNumber(locale, safeIndex + 1), localizedNumber(locale, total));

  const closeTour = useCallback(() => {
    dialogRef.current?.close();
    setOpen(false);
    setIndex(0);
  }, []);

  // Open on every visit to the home page; no persistence, no "seen" flag.
  useEffect(() => {
    if (window.location.pathname !== "/") return;

    const timer = setTimeout(() => {
      setIndex(0);
      setOpen(true);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const reopen = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      primaryRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleClose() {
    setOpen(false);
    setIndex(0);
  }

  return (
    <dialog
      ref={dialogRef}
      className="onboarding-dialog"
      aria-labelledby="onboarding-title"
      onClose={handleClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeTour();
      }}
    >
      <div className="onboarding-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
              {t.onboarding.label}
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-300" dir="ltr">
              {progress}
            </p>
          </div>
          <button
            type="button"
            onClick={closeTour}
            className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
          >
            {t.onboarding.skip}
          </button>
        </div>

        <div className="mt-3 flex gap-1.5" aria-hidden="true">
          {capabilities.map((item, segment) => (
            <span
              key={item.title}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                segment <= safeIndex ? `bg-gradient-to-r ${bar}` : "bg-white/10"
              }`}
            />
          ))}
        </div>

        <div
          key={safeIndex}
          className="onboarding-slide mt-8"
          role="group"
          aria-roledescription="slide"
          aria-label={t.onboarding.step(localizedNumber(locale, safeIndex + 1), localizedNumber(locale, total))}
          aria-live="polite"
        >
          <div className="relative">
            <span
              className={`pointer-events-none absolute -inset-6 rounded-full blur-3xl ${glow}`}
              aria-hidden="true"
            />
            <span
              className={`relative grid h-14 w-14 place-items-center rounded-2xl border ${iconBox}`}
            >
              <Icon className="h-6 w-6" />
            </span>
          </div>

          <h2
            id="onboarding-title"
            className="mt-6 text-2xl font-semibold tracking-tight text-white sm:text-3xl"
          >
            {capability.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{capability.short}</p>

          <ul className="mt-6 space-y-2.5">
            {capability.points.map((point) => (
              <li key={point} className="flex gap-2.5 text-sm leading-6 text-zinc-300">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r ${bar}`} />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-white/[0.08] pt-5">
          <button
            type="button"
            onClick={() => setIndex(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
            className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {t.onboarding.previous}
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={() => {
              if (isLast) closeTour();
              else setIndex(safeIndex + 1);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-lime-300 px-5 py-2.5 text-sm font-semibold text-[#10150d] transition hover:bg-lime-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
          >
            {isLast ? t.onboarding.getStarted : t.onboarding.next}
            {!isLast && <ArrowRightIcon className="h-4 w-4 rtl:rotate-180" />}
          </button>
        </div>
      </div>
    </dialog>
  );
}
