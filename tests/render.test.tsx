import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportView } from "../components/report-view";
import { LanguageProvider } from "../components/language-provider";
import type { Report } from "../lib/reports/schema";

function reportWith(title = "Potential hardcoded credential"): Report {
  return {
    version: 1,
    id: "report-test",
    generatedAt: "2026-10-24T12:00:00.000Z",
    repo: {
      owner: "owner",
      name: "repo",
      fullName: "owner/repo",
      htmlUrl: "https://github.com/owner/repo",
      issuesUrl: "https://github.com/owner/repo/issues",
      description: "A test repository",
      defaultBranch: "main",
      stars: 10,
      forks: 2,
      sizeKb: 1000,
      license: "MIT",
      archived: false,
      pushedAt: "2026-10-20T00:00:00.000Z",
    },
    languages: [{ name: "TypeScript", percentage: 100 }],
    mode: {
      ai: false,
      provider: "none",
      model: null,
      note: "No AI provider is configured. Static analysis still runs.",
    },
    stats: {
      treeEntries: 20,
      filesSelected: 10,
      filesAnalyzed: 10,
      filesSkipped: 10,
      treeTruncated: false,
      durationMs: 1234,
    },
    warnings: [],
    summary: "Found 1 potential issue.",
    findings: [
      {
        id: "static-test",
        source: "static",
        evidenceStatus: "verified",
        severity: "high",
        confidence: "medium",
        category: "security",
        title,
        explanation: "A credential-shaped value is committed.",
        file: "src/config.ts",
        startLine: 12,
        endLine: 12,
        evidence: 'const apiKey = "[REDACTED]";',
        whyProblematic: "The credential may be recoverable from repository history.",
        suggestedFix: "Rotate the value and load it from the server environment.",
        issue: {
          title: "[high] Potential hardcoded credential in src/config.ts",
          body: "## Summary\nA credential-shaped value is committed.",
        },
      },
    ],
  };
}

test("report renders evidence, filters, issue copy controls, and manual steps", () => {
  const html = renderToStaticMarkup(
    <LanguageProvider>
      <ReportView report={reportWith()} />
    </LanguageProvider>,
  );

  assert.match(html, /owner\/repo/);
  assert.match(html, /Potential hardcoded credential/);
  assert.match(html, /src\/config\.ts/);
  assert.match(html, /Evidence matched/);
  assert.match(html, /Copy title/);
  assert.match(html, /Copy description/);
  assert.match(html, /Open GitHub Issues/);
  assert.match(html, /Saulify never creates issues or comments/);
  assert.match(html, /Static analysis only/);
});

test("report renders Persian interface while keeping technical findings unchanged", () => {
  const html = renderToStaticMarkup(
    <LanguageProvider initialLocale="fa">
      <ReportView report={reportWith()} />
    </LanguageProvider>,
  );

  assert.match(html, /گزارش تحلیل مخزن/);
  assert.match(html, /شواهد مطابقت دارد/);
  assert.match(html, /کپی عنوان/);
  assert.match(html, /ارسال دستی ایشو/);
  assert.match(html, /فقط تحلیل ایستا/);
  assert.match(html, /Potential hardcoded credential/);
  assert.match(html, /src\/config\.ts/);
  assert.match(html, /dir="ltr"/);
});

test("report exposes the AI failure reason and marks the configured model as unused", () => {
  const report = reportWith();
  report.mode = {
    ai: false,
    provider: "OpenAI-compatible endpoint",
    model: "gemini-3.6-flash",
    note: "AI review was configured but unavailable.",
  };
  report.warnings = ["AI review failed: AI provider timed out."];

  const html = renderToStaticMarkup(
    <LanguageProvider>
      <ReportView report={report} />
    </LanguageProvider>,
  );

  assert.match(html, /not used/);
  assert.match(html, /AI review could not complete: AI provider timed out/);
  assert.match(html, /gemini-3\.6-flash/);
});

test("report escapes repository and finding text instead of rendering HTML", () => {
  const html = renderToStaticMarkup(
    <LanguageProvider>
      <ReportView report={reportWith("<script>alert(1)</script>")} />
    </LanguageProvider>,
  );
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
