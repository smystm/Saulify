import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAstFiles } from "../lib/analyzer/ast";
import { analyzeArchitecture, ARCHITECTURE_MAX_FINDINGS } from "../lib/analyzer/architecture";
import { collectStructureMetrics } from "../lib/analyzer/architecture/structure";
import { inferLayer, isLayerViolation } from "../lib/analyzer/architecture/layers";
import type { FetchedFile, TreeEntry } from "../lib/github/client";

function treeFor(files: FetchedFile[]): TreeEntry[] {
  return files.map((file) => ({ path: file.path, type: "blob" as const, size: file.content.length }));
}

function architecture(
  files: FetchedFile[],
  options: {
    treeEntries?: TreeEntry[];
    treeTruncated?: boolean;
    fullCoverage?: boolean;
    maxFindings?: number;
  } = {},
) {
  const ast = analyzeAstFiles(files, { knownPaths: files.map((file) => file.path) });
  return analyzeArchitecture({
    files,
    treeEntries: options.treeEntries ?? treeFor(files),
    treeTruncated: options.treeTruncated ?? false,
    imports: ast.imports,
    analyzedPaths: ast.structures.map((structure) => structure.path),
    knownPaths: new Set(files.map((file) => file.path)),
    fullCoverage: options.fullCoverage ?? true,
    maxFindings: options.maxFindings,
  });
}

test("architecture reports strongly connected module cycles with related locations", () => {
  const result = architecture([
    { path: "src/a.ts", content: 'import { b } from "./b";\nexport const a = b;' },
    { path: "src/b.ts", content: 'import { a } from "./a";\nexport const b = a;' },
  ]);

  const cycle = result.findings.find((finding) => finding.title.includes("Circular module dependency"));
  assert.ok(cycle);
  assert.equal(cycle.source, "quality");
  assert.equal(cycle.category, "architecture");
  assert.equal(cycle.assessment, "measured");
  assert.equal(cycle.confidence, "high");
  assert.ok(cycle.relatedLocations && cycle.relatedLocations.length > 0);
  assert.match(cycle.evidence, /src\/a\.ts/);
  assert.match(cycle.evidence, /src\/b\.ts/);
});

test("architecture excludes type-only imports from runtime cycles", () => {
  const result = architecture([
    {
      path: "src/a.ts",
      content: 'import type { B } from "./b";\nexport type A = B;',
    },
    {
      path: "src/b.ts",
      content: 'import type { A } from "./a";\nexport type B = A;',
    },
  ]);

  assert.equal(result.findings.some((finding) => finding.title.includes("Circular module dependency")), false);
});

test("architecture reports coupling hubs and dependency concentration", () => {
  const leaves = Array.from({ length: 6 }, (_, index) => ({
    path: `src/leaf${index}.ts`,
    content: `import { hub } from "./hub";\nexport const leaf${index} = hub;`,
  }));
  const result = architecture([
    { path: "src/hub.ts", content: "export const hub = 1;" },
    ...leaves,
  ]);

  assert.ok(result.findings.some((finding) => finding.title === "Highly coupled module"));
  assert.ok(
    result.findings.some((finding) =>
      finding.title.includes("concentrated around one module"),
    ),
  );
  assert.ok(result.findings.every((finding) => finding.category === "architecture"));
});

test("architecture reports inferred layer violations as advisory findings", () => {
  const result = architecture([
    { path: "components/ui.ts", content: 'import { db } from "../data/db";\nexport const ui = db;' },
    { path: "data/db.ts", content: "export const db = 1;" },
    { path: "api/routes.ts", content: 'import { db } from "../data/db";\nexport const route = db;' },
    { path: "domain/service.ts", content: 'import { db } from "../data/db";\nexport const service = db;' },
  ]);

  const violation = result.findings.find((finding) => finding.title.includes("layer violation"));
  assert.ok(violation);
  assert.equal(violation.assessment, "advisory");
  assert.equal(violation.confidence, "low");
  assert.match(violation.title, /presentation imports data/);
});

test("architecture reports repository structure sprawl without a truncated tree", () => {
  const rootFiles = Array.from({ length: 13 }, (_, index) => `root${index}.ts`);
  const treeEntries: TreeEntry[] = [
    ...rootFiles.map((path) => ({ path, type: "blob" as const, size: 10 })),
    { path: "a/b/c/d/e/f/g/h/deep.ts", type: "blob", size: 10 },
  ];
  const result = architecture(
    [{ path: "root0.ts", content: "export const root = 1;" }],
    { treeEntries },
  );

  assert.ok(result.findings.some((finding) => finding.title.includes("repository root")));

  const metrics = collectStructureMetrics(treeEntries);
  assert.equal(metrics.rootSourceFiles.length, 13);
  assert.equal(metrics.deepPaths.length, 1);
});

test("structure metrics keep real sample paths for fragmented directories", () => {
  const treeEntries: TreeEntry[] = Array.from({ length: 13 }, (_, index) => ({
    path: `module${index}/index${index}.ts`,
    type: "blob" as const,
    size: 10,
  }));
  const metrics = collectStructureMetrics(treeEntries);

  assert.equal(metrics.fragmentedDirs.length, 13);
  assert.ok(
    metrics.fragmentedDirs.every((entry) => entry.sample.startsWith(`${entry.directory}/`)),
  );
});

test("architecture skips structure findings when the tree is truncated", () => {
  const treeEntries: TreeEntry[] = Array.from({ length: 13 }, (_, index) => ({
    path: `root${index}.ts`,
    type: "blob" as const,
    size: 10,
  }));
  const result = architecture(
    [{ path: "root0.ts", content: "export const root = 1;" }],
    { treeEntries, treeTruncated: true },
  );

  assert.equal(result.findings.some((finding) => finding.title.includes("repository root")), false);
  assert.match(result.warning ?? "", /tree was truncated/);
});

test("architecture reports mixed ES module and CommonJS usage", () => {
  const result = architecture([
    { path: "esm/a.ts", content: 'import { shared } from "./shared";\nexport const a = shared;' },
    { path: "esm/b.ts", content: 'import { shared } from "./shared";\nexport const b = shared;' },
    { path: "esm/shared.ts", content: "export const shared = 1;" },
    { path: "cjs/c.ts", content: 'const shared = require("./shared");\nmodule.exports = shared;' },
    { path: "cjs/e.ts", content: 'const shared = require("./shared");\nmodule.exports = shared;' },
    { path: "cjs/shared.ts", content: "module.exports = 1;" },
  ]);

  assert.ok(result.findings.some((finding) => finding.title.includes("ES modules and CommonJS")));
});

test("architecture warns about sample coverage and caps findings", () => {
  const files = Array.from({ length: 12 }, (_, index) => {
    const next = index % 2 === 0 ? index + 1 : index - 1;
    return {
      path: `src/cycle${index}.ts`,
      content: `import { value } from "./cycle${next}";\nexport const value${index} = value;`,
    };
  });
  const result = architecture(files, { fullCoverage: false });

  assert.equal(result.findings.length, ARCHITECTURE_MAX_FINDINGS);
  assert.match(result.warning ?? "", /selected sample/);
});

test("layer inference recognizes common directory names", () => {
  assert.equal(inferLayer("components/ui/button.tsx"), "presentation");
  assert.equal(inferLayer("api/routes/users.ts"), "interface");
  assert.equal(inferLayer("domain/services/user.ts"), "domain");
  assert.equal(inferLayer("data/repositories/user.ts"), "data");
  assert.equal(inferLayer("shared/utils/date.ts"), "shared");
  assert.equal(inferLayer("scripts/build.ts"), null);
  assert.equal(isLayerViolation("presentation", "data"), true);
  assert.equal(isLayerViolation("data", "presentation"), true);
  assert.equal(isLayerViolation("domain", "presentation"), true);
  assert.equal(isLayerViolation("shared", "domain"), false);
});
