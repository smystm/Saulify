import type { Severity } from "@/lib/reports/schema";

export type SeverityInput = {
  database_specific?: Record<string, unknown> | null;
  severity?: Array<{ type?: string; score?: string }> | null;
};

const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC: Record<string, number> = { L: 0.77, H: 0.44 };
const UI: Record<string, number> = { N: 0.85, R: 0.62 };
const CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

function roundUp(value: number): number {
  return Math.ceil(value * 10 - 1e-9) / 10;
}

export function cvss3BaseScore(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const parts = new Map(
    vector
      .split("/")
      .slice(1)
      .map((part) => {
        const [key, value] = part.split(":");
        return [key, value] as const;
      }),
  );

  const av = AV[parts.get("AV") ?? ""];
  const ac = AC[parts.get("AC") ?? ""];
  const ui = UI[parts.get("UI") ?? ""];
  const scope = parts.get("S");
  const confidentiality = CIA[parts.get("C") ?? ""];
  const integrity = CIA[parts.get("I") ?? ""];
  const availability = CIA[parts.get("A") ?? ""];
  const privilegeRaw = parts.get("PR");
  if (
    av === undefined ||
    ac === undefined ||
    ui === undefined ||
    (scope !== "U" && scope !== "C") ||
    confidentiality === undefined ||
    integrity === undefined ||
    availability === undefined ||
    (privilegeRaw !== "N" && privilegeRaw !== "L" && privilegeRaw !== "H")
  ) {
    return null;
  }

  const privilege =
    scope === "U"
      ? { N: 0.85, L: 0.62, H: 0.27 }[privilegeRaw]
      : { N: 0.85, L: 0.68, H: 0.5 }[privilegeRaw];
  const iss = 1 - (1 - confidentiality) * (1 - integrity) * (1 - availability);
  const impact =
    scope === "U" ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15;
  const exploitability = 8.22 * av * ac * privilege * ui;

  if (impact <= 0) return 0;
  const score = scope === "U" ? Math.min(impact + exploitability, 10) : Math.min(1.08 * (impact + exploitability), 10);
  return Math.min(10, Math.max(0, roundUp(score)));
}

function fromScore(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function fromLabel(label: string): Severity | null {
  switch (label.trim().toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "moderate":
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return null;
  }
}

export function severityFromOsv(input: SeverityInput): { severity: Severity; source: string } {
  const databaseSeverity = input.database_specific?.severity;
  if (typeof databaseSeverity === "string") {
    const mapped = fromLabel(databaseSeverity);
    if (mapped) return { severity: mapped, source: `advisory severity ${databaseSeverity}` };
  }

  for (const entry of input.severity ?? []) {
    if (entry.type !== "CVSS_V3" || typeof entry.score !== "string") continue;
    const score = cvss3BaseScore(entry.score);
    if (score === null) continue;
    return { severity: fromScore(score), source: `CVSS v3 base score ${score.toFixed(1)}` };
  }

  return { severity: "medium", source: "no published severity; defaulted to medium" };
}
