import test from "node:test";
import assert from "node:assert/strict";
import { analyzeStaticFiles } from "../lib/analyzer/static";
import { dedupeFindings } from "../lib/analyzer";

test("static rules produce evidence-backed findings with issue drafts", () => {
  const secret = "sk-live-this-must-not-leak";
  const findings = analyzeStaticFiles([
    {
      path: "src/routes/handler.ts",
      content: [
        'const apiKey = "sk-live-this-must-not-leak";',
        "export function run(req: any) {",
        "  return eval(req.query.expression);",
        "}",
        "try { work(); } catch (error) {}",
      ].join("\n"),
    },
    {
      path: "src/render.tsx",
      content: "export const X = () => <div dangerouslySetInnerHTML={{ __html: html }} />;",
    },
  ]);

  assert.ok(findings.some((finding) => finding.title.includes("eval")));
  assert.ok(findings.some((finding) => finding.title.includes("credential")));
  assert.ok(findings.some((finding) => finding.title.includes("silently")));
  assert.ok(findings.some((finding) => finding.title.includes("Raw HTML")));
  assert.ok(findings.every((finding) => finding.issue.title.length > 0 && finding.issue.body.length > 0));
  assert.ok(findings.every((finding) => finding.evidenceStatus === "verified" && finding.source === "static"));

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes(secret), false);
  assert.match(serialized, /\[REDACTED\]/);
});

test("static findings stay bounded for noisy files", () => {
  const noisy = Array.from({ length: 50 }, (_, index) => `eval(input${index});`).join("\n");
  const findings = analyzeStaticFiles([{ path: "src/noisy.ts", content: noisy }], 10);
  assert.ok(findings.length <= 10);
  assert.equal(findings.length, 2);
});

test("deduplication collapses repeated nearby findings", () => {
  const findings = analyzeStaticFiles([
    {
      path: "src/repeated.ts",
      content: "eval(first);\neval(second);\nconst value = 1;",
    },
  ]);
  assert.equal(findings.length, 2);
  const deduped = dedupeFindings(findings);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].source, "static");
});
