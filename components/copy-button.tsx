"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/language-provider";
import { CheckIcon, CopyIcon } from "@/components/icons";

type CopyButtonProps = {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  title?: string;
};

export function CopyButton({
  text,
  label,
  copiedLabel,
  className = "",
  title,
}: CopyButtonProps) {
  const { t } = useI18n();
  const resolvedLabel = label ?? t.common.copy;
  const resolvedCopiedLabel = copiedLabel ?? t.common.copied;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    let success = false;
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        success = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        success = false;
      }
    }

    if (!success) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={title ?? resolvedLabel}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300 ${className}`}
      aria-live="polite"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5 text-lime-300" /> : <CopyIcon className="h-3.5 w-3.5" />}
      {copied ? resolvedCopiedLabel : resolvedLabel}
    </button>
  );
}
