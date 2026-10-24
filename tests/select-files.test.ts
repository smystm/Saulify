import test from "node:test";
import assert from "node:assert/strict";
import { isAnalyzableFile, selectFiles, MAX_SELECTED_FILES } from "../lib/analyzer/select-files";
import type { TreeEntry } from "../lib/github/client";

function blob(path: string, size = 1_000): TreeEntry {
  return { path, size, type: "blob" };
}

test("filters binaries, secrets, vendored code, and oversized files", () => {
  assert.equal(isAnalyzableFile(blob("src/index.ts")), true);
  assert.equal(isAnalyzableFile(blob("node_modules/pkg/index.js")), false);
  assert.equal(isAnalyzableFile(blob(".env")), false);
  assert.equal(isAnalyzableFile(blob(".env.production")), false);
  assert.equal(isAnalyzableFile(blob("public/logo.png")), false);
  assert.equal(isAnalyzableFile(blob("dist/app.js")), false);
  assert.equal(isAnalyzableFile(blob("src/app.min.js")), false);
  assert.equal(isAnalyzableFile(blob("src/types.d.ts")), false);
  assert.equal(isAnalyzableFile(blob("src/huge.ts", 500_000)), false);
  assert.equal(isAnalyzableFile(blob("pnpm-lock.yaml")), false);
});

test("selects a deterministic, capped, risk-prioritized set", () => {
  const entries = [
    blob("docs/readme.ts"),
    blob("test/helper.ts"),
    blob("src/random.ts"),
    blob("src/auth/session.ts"),
    blob("src/payments/checkout.ts"),
    blob("app/api/upload/route.ts"),
    ...Array.from({ length: 25 }, (_, i) => blob(`zlib/module-${i}.ts`)),
    { path: "src", size: 0, type: "tree" as const },
  ];

  const first = selectFiles(entries);
  const second = selectFiles(entries);

  assert.deepEqual(first.selected, second.selected);
  assert.equal(first.selected.length, MAX_SELECTED_FILES);
  assert.ok(first.selected.indexOf("src/auth/session.ts") < first.selected.indexOf("src/random.ts"));
  assert.ok(first.selected.includes("app/api/upload/route.ts"));
  assert.equal(first.selected.includes("docs/readme.ts"), false);
});
