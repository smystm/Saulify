import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportView } from "../components/report-view";
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
  const html = renderToStaticMarkup(<ReportView report={reportWith()} />);

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

test("report escapes repository and finding text instead of rendering HTML", () => {
  const html = renderToStaticMarkup(<ReportView report={reportWith("<script>alert(1)</script>")} />);
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
