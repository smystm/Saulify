import { z } from "zod";
import {
  categorySchema,
  confidenceSchema,
  severitySchema,
} from "@/lib/reports/schema";

export const aiFindingSchema = z.object({
  title: z.string().trim().min(5).max(160),
  severity: severitySchema,
  confidence: confidenceSchema,
  category: categorySchema,
  explanation: z.string().trim().min(20).max(1800),
  file: z.string().trim().max(500).nullable().optional(),
  startLine: z.number().int().positive().max(5_000_000).nullable().optional(),
  endLine: z.number().int().positive().max(5_000_000).nullable().optional(),
  evidence: z.string().max(1500).optional(),
  whyProblematic: z.string().trim().min(10).max(1500),
  suggestedFix: z.string().trim().min(5).max(1500),
  issueTitle: z.string().trim().min(5).max(180).optional(),
  issueBody: z.string().trim().min(10).max(6000).optional(),
});

export const aiResponseSchema = z.object({
  findings: z.array(aiFindingSchema).max(12),
});

export type AiFinding = z.infer<typeof aiFindingSchema>;

export type ParsedAiResponse =
  | { ok: true; data: { findings: AiFinding[] } }
  | { ok: false; error: string };

/**
 * Models sometimes wrap JSON in prose or Markdown fences. Only the extracted
 * object is parsed, then the entire shape is checked by Zod.
 */
export function parseAiResponse(raw: string): ParsedAiResponse {
  if (!raw || raw.length > 150_000) {
    return { ok: false, error: "AI response was empty or too large." };
  }

  const trimmed = raw.trim();
  if (
    !trimmed.includes("{") &&
    /^(sorry\b|i (?:cannot|can't|am unable|'m unable)\b)/i.test(trimmed)
  ) {
    return {
      ok: false,
      error: "The AI provider declined to review the supplied code. Try another model or provider.",
    };
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const extracted =
    firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : null;
  const candidates = [...new Set([trimmed, fenced, extracted].filter((value): value is string => Boolean(value)))];

  for (const candidate of candidates) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }

    const result = aiResponseSchema.safeParse(json);
    if (result.success) return { ok: true, data: result.data };

    const detail = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `AI response did not match the required schema (${detail}).` };
  }

  return { ok: false, error: "AI response was not valid JSON." };
}
