"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { reportSchema, type Report } from "@/lib/reports/schema";
import { ReportView } from "@/components/report-view";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/components/language-provider";
import { AlertIcon, ShieldIcon } from "@/components/icons";

type State = { status: "loading" } | { status: "ready"; report: Report } | { status: "missing" };

export function ReportClient({ id }: { id: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!active) return;
      try {
        const raw = sessionStorage.getItem(`saulify:report:${id}`);
        if (!raw) {
          setState({ status: "missing" });
          return;
        }
        const parsed = reportSchema.safeParse(JSON.parse(raw));
        if (!parsed.success || parsed.data.id !== id) {
          setState({ status: "missing" });
          return;
        }
        setState({ status: "ready", report: parsed.data });
      } catch {
        setState({ status: "missing" });
      }
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);

  if (state.status === "loading") {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-4 bg-[#070908] px-5">
        <div className="absolute end-5 top-5">
          <LanguageSwitcher />
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300">
          <ShieldIcon className="h-5 w-5" />
        </span>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/10 border-t-lime-300" />
          {t.report.loading}
        </div>
      </div>
    );
  }

  if (state.status === "missing") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-[#070908] px-5">
        <div className="absolute end-5 top-5">
          <LanguageSwitcher />
        </div>
        <div className="max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 text-center">
          <AlertIcon className="mx-auto h-7 w-7 text-amber-300/80" />
          <h1 className="mt-4 text-lg font-semibold text-white">{t.report.missingTitle}</h1>
          <p className="mt-2 text-xs leading-6 text-zinc-500">{t.report.missingDescription}</p>
          <Link
            href="/"
            className="mt-5 inline-flex rounded-lg bg-lime-300 px-4 py-2 text-xs font-semibold text-[#10150d] transition hover:bg-lime-200"
          >
            {t.report.startNew}
          </Link>
        </div>
      </div>
    );
  }

  return <ReportView report={state.report} />;
}
