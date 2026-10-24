import { z } from "zod";

export const severitySchema = z.enum(["critical", "high", "medium", "low"]);
export const confidenceSchema = z.enum(["high", "medium", "low"]);
export const categorySchema = z.enum([
  "security",
  "correctness",
  "reliability",
  "performance",
  "maintainability",
  "other",
]);
export const sourceSchema = z.enum(["static", "ai"]);
export const evidenceStatusSchema = z.enum(["verified", "unverified"]);

export const githubIssueSchema = z.object({
  title: z.string().min(1).max(220),
  body: z.string().min(1).max(10_000),
});

const githubUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://github.com/"), "Expected an HTTPS GitHub URL.");

export const findingSchema = z.object({
  id: z.string().min(1).max(100),
  source: sourceSchema,
  evidenceStatus: evidenceStatusSchema,
  severity: severitySchema,
  confidence: confidenceSchema,
  category: categorySchema,
  title: z.string().min(1).max(200),
  explanation: z.string().min(1).max(4000),
  file: z.string().max(500).nullable(),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  evidence: z.string().max(2400),
  whyProblematic: z.string().max(3000),
  suggestedFix: z.string().max(3000),
  issue: githubIssueSchema,
});

export const reportSchema = z.object({
  version: z.literal(1),
  id: z.string().min(4).max(100),
  generatedAt: z.string(),
  repo: z.object({
    owner: z.string(),
    name: z.string(),
    fullName: z.string(),
    htmlUrl: githubUrlSchema,
    issuesUrl: githubUrlSchema,
    description: z.string().nullable(),
    defaultBranch: z.string(),
    stars: z.number().int().nonnegative(),
    forks: z.number().int().nonnegative(),
    sizeKb: z.number().int().nonnegative(),
    license: z.string().nullable(),
    archived: z.boolean(),
    pushedAt: z.string().nullable(),
  }),
  languages: z.array(
    z.object({
      name: z.string(),
      percentage: z.number().min(0).max(100),
    }),
  ),
  mode: z.object({
    ai: z.boolean(),
    provider: z.string(),
    model: z.string().nullable(),
    note: z.string(),
  }),
  stats: z.object({
    treeEntries: z.number().int().nonnegative(),
    filesSelected: z.number().int().nonnegative(),
    filesAnalyzed: z.number().int().nonnegative(),
    filesSkipped: z.number().int().nonnegative(),
    treeTruncated: z.boolean(),
    durationMs: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string()),
  summary: z.string().max(3000),
  findings: z.array(findingSchema).max(30),
});

export type Severity = z.infer<typeof severitySchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Report = z.infer<typeof reportSchema>;
