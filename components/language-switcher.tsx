"use client";

import { useI18n } from "@/components/language-provider";
import type { Locale } from "@/lib/i18n";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  const options: Array<{ value: Locale; label: string; full: string }> = [
    { value: "en", label: t.common.enShort, full: t.common.english },
    { value: "fa", label: t.common.faShort, full: t.common.persian },
  ];

  return (
    <div
      role="group"
      aria-label={t.common.switchLanguage}
      className={`inline-flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-0.5 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.value}
          onClick={() => setLocale(option.value)}
          aria-pressed={locale === option.value}
          aria-label={`${t.common.switchLanguage}: ${option.full}`}
          className={`rounded-md px-2 py-1 text-[10px] font-semibold transition ${
            locale === option.value
              ? "bg-lime-300 text-[#10150d]"
              : "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
