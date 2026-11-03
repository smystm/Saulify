import test from "node:test";
import assert from "node:assert/strict";
import {
  cvss3BaseScore,
  severityFromOsv,
} from "../lib/analyzer/dependencies/severity";
import {
  lookupVulnerabilities,
  resetOsvCacheForTests,
} from "../lib/analyzer/dependencies/osv";
import {
  isOutdatedVersion,
  lookupLatestVersions,
  resetRegistryCacheForTests,
} from "../lib/analyzer/dependencies/registry";
import { findUnusedDependencies } from "../lib/analyzer/dependencies/unused";
import { analyzeDependencies } from "../lib/analyzer/dependencies";
import type { DependencyFile, DependencyPackage } from "../lib/analyzer/dependencies/types";
import type { FetchedFile } from "../lib/github/client";

function pkg(overrides: Partial<DependencyPackage> = {}): DependencyPackage {
  return {
    ecosystem: "npm",
    name: "lodash",
    version: "4.17.20",
    declaredRange: "^4.17.20",
    direct: true,
    dev: false,
    runtime: true,
    manifest: "package-lock.json",
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function detail(id = "GHSA-test-1234", overrides: Record<string, unknown> = {}) {
  return {
    id,
    summary: "Prototype pollution in lodash",
    details: "A detailed advisory about lodash.",
    aliases: ["CVE-2021-23337"],
    severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
    affected: [
      {
        package: { ecosystem: "npm", name: "lodash" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }],
      },
    ],
    references: [{ type: "ADVISORY", url: "https://github.com/advisories/GHSA-test-1234" }],
    ...overrides,
  };
}

function batch(ids: string[]) {
  return { results: [{ vulns: ids.map((id) => ({ id })) }] };
}

test("CVSS v3 base score and severity mapping are deterministic", () => {
  assert.equal(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
  assert.equal(cvss3BaseScore("not a vector"), null);
  assert.equal(severityFromOsv({ database_specific: { severity: "HIGH" } }).severity, "high");
  assert.equal(severityFromOsv({ database_specific: { severity: "MODERATE" } }).severity, "medium");
  assert.equal(
    severityFromOsv({
      severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
    }).severity,
    "critical",
  );
  assert.equal(severityFromOsv({}).severity, "medium");
});

test("OSV lookup only returns findings backed by a parsed advisory and exact version", async () => {
  resetOsvCacheForTests();
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/v1/querybatch")) return jsonResponse(batch(["GHSA-test-1234"]));
    if (url.endsWith("/v1/vulns/GHSA-test-1234")) return jsonResponse(detail());
    return jsonResponse({}, 404);
  }) as typeof fetch;

  const result = await lookupVulnerabilities([pkg()], { fetchImpl });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].vuln.id, "GHSA-test-1234");
  assert.equal(result.matches[0].package.name, "lodash");
  assert.equal(calls[0].url, "https://api.osv.dev/v1/querybatch");
  assert.deepEqual(calls[0].body, {
    queries: [{ package: { name: "lodash", ecosystem: "npm" }, version: "4.17.20" }],
  });
  assert.equal(calls[1].url, "https://api.osv.dev/v1/vulns/GHSA-test-1234");
});

test("OSV returns no match for an unaffected version", async () => {
  resetOsvCacheForTests();
  let detailCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/v1/querybatch")) return jsonResponse({ results: [{}] });
    detailCalls++;
    return jsonResponse(detail());
  }) as typeof fetch;

  const result = await lookupVulnerabilities([pkg({ version: "4.17.21" })], { fetchImpl });
  assert.equal(result.matches.length, 0);
  assert.equal(detailCalls, 0);
});

test("OSV detail and batch failures degrade to warnings without findings", async () => {
  resetOsvCacheForTests();
  const detailFailure = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/v1/querybatch")) return jsonResponse(batch(["GHSA-test-1234"]));
    return jsonResponse({ error: "boom" }, 500);
  }) as typeof fetch;

  const first = await lookupVulnerabilities([pkg()], { fetchImpl: detailFailure });
  assert.equal(first.matches.length, 0);
  assert.ok(first.warnings.some((warning) => /OSV|advisory|detail/i.test(warning)));

  resetOsvCacheForTests();
  const batchFailure = (async () => jsonResponse({ error: "boom" }, 500)) as typeof fetch;
  const second = await lookupVulnerabilities([pkg()], { fetchImpl: batchFailure });
  assert.equal(second.matches.length, 0);
  assert.ok(second.warnings.some((warning) => /OSV|lookup/i.test(warning)));

  resetOsvCacheForTests();
  const malformed = (async () => new Response("{not json", { status: 200 })) as typeof fetch;
  const third = await lookupVulnerabilities([pkg()], { fetchImpl: malformed });
  assert.equal(third.matches.length, 0);
  assert.ok(third.warnings.length > 0);
});

test("OSV query and advisory caches avoid duplicate network calls", async () => {
  resetOsvCacheForTests();
  let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls++;
    if (String(input).endsWith("/v1/querybatch")) return jsonResponse(batch(["GHSA-test-1234"]));
    return jsonResponse(detail());
  }) as typeof fetch;

  await lookupVulnerabilities([pkg()], { fetchImpl });
  const second = await lookupVulnerabilities([pkg()], { fetchImpl });

  assert.equal(calls, 2);
  assert.equal(second.matches.length, 1);
});

test("OSV query and detail budgets cap work", async () => {
  resetOsvCacheForTests();
  let batchCalls = 0;
  const queries: Array<{ queries: unknown[] }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/v1/querybatch")) {
      batchCalls++;
      const body = JSON.parse(String(init?.body)) as { queries: unknown[] };
      queries.push(body);
      return jsonResponse({ results: body.queries.map(() => ({})) });
    }
    return jsonResponse(detail());
  }) as typeof fetch;

  const packages = Array.from({ length: 250 }, (_, index) =>
    pkg({ name: `pkg-${index}`, version: "1.0.0" }),
  );
  await lookupVulnerabilities(packages, { fetchImpl });
  assert.equal(batchCalls, 2);
  assert.equal(queries.reduce((sum, item) => sum + item.queries.length, 0), 200);

  resetOsvCacheForTests();
  let detailCalls = 0;
  const detailFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/v1/querybatch")) {
      const body = JSON.parse(String(init?.body)) as { queries: Array<{ package: { name: string } }> };
      return jsonResponse({
        results: body.queries.map((query) => ({ vulns: [{ id: `GHSA-${query.package.name}` }] })),
      });
    }
    detailCalls++;
    const id = decodeURIComponent(String(input).split("/").pop() ?? "");
    const name = id.replace(/^GHSA-/, "");
    return jsonResponse(detail(id, { affected: [{ package: { ecosystem: "npm", name } }] }));
  }) as typeof fetch;

  const details = Array.from({ length: 45 }, (_, index) =>
    pkg({ name: `pkg-${index}`, version: "1.0.0" }),
  );
  const capped = await lookupVulnerabilities(details, { fetchImpl: detailFetch });
  assert.equal(detailCalls, 40);
  assert.equal(capped.matches.length, 40);
  assert.ok(capped.warnings.some((warning) => /detail|limit/i.test(warning)));
});

test("outdated version comparison ignores unparsable versions", () => {
  assert.equal(isOutdatedVersion("1.2.3", "1.3.0"), true);
  assert.equal(isOutdatedVersion("1.2.3", "1.2.3"), false);
  assert.equal(isOutdatedVersion("2.0.0", "1.9.9"), false);
  assert.equal(isOutdatedVersion("1.0.0-beta.1", "1.0.0"), true);
  assert.equal(isOutdatedVersion("latest", "2.0.0"), false);
});

test("registry lookup supports npm and PyPI and caps direct checks", async () => {
  resetRegistryCacheForTests();
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("registry.npmjs.org")) return jsonResponse({ version: "4.17.21" });
    return jsonResponse({ info: { version: "2.32.0" } });
  }) as typeof fetch;

  const result = await lookupLatestVersions(
    [pkg(), pkg({ ecosystem: "PyPI", name: "requests", version: "2.31.0" })],
    { fetchImpl },
  );
  assert.equal(result.versions.get("npm|lodash"), "4.17.21");
  assert.equal(result.versions.get("PyPI|requests"), "2.32.0");
  assert.equal(calls.some((url) => url.endsWith("/lodash/latest")), true);
  assert.equal(calls.some((url) => url.includes("pypi.org/pypi/requests/json")), true);

  resetRegistryCacheForTests();
  const many = Array.from({ length: 12 }, (_, index) => pkg({ name: `pkg-${index}` }));
  let limitedCalls = 0;
  const limited = (async () => {
    limitedCalls++;
    return jsonResponse({ version: "9.9.9" });
  }) as typeof fetch;
  const capped = await lookupLatestVersions(many, { fetchImpl: limited });
  assert.equal(limitedCalls, 10);
  assert.ok(capped.warnings.some((warning) => /limited|not checked/i.test(warning)));
});

test("registry failures degrade to warnings", async () => {
  resetRegistryCacheForTests();
  const fetchImpl = (async () => jsonResponse({ error: "down" }, 500)) as typeof fetch;
  const result = await lookupLatestVersions([pkg()], { fetchImpl });
  assert.equal(result.versions.size, 0);
  assert.ok(result.warnings.length > 0);
});

test("unused dependency detection uses imports, scripts, coverage, and conservative filters", () => {
  const source = (path: string, content: string): FetchedFile => ({ path, content });
  const packages = [
    pkg({ name: "used-package" }),
    pkg({ name: "unused-package" }),
    pkg({ name: "script-package" }),
    pkg({ name: "export-package" }),
    pkg({ name: "dotenv" }),
    pkg({ name: "dev-package", dev: true, runtime: false }),
    pkg({ name: "@scope/used", version: "1.0.0" }),
  ];

  const result = findUnusedDependencies(
    packages,
    [
      source("src/app.ts", 'import thing from "used-package/sub";\nimport scoped from "@scope/used";\nexport { value } from "export-package";'),
      source("src/other.tsx", 'const mod = require("unused-package");'),
    ],
    {
      fullCoverage: true,
      eligibleFiles: 2,
      analyzedFiles: 2,
      manifestContent: JSON.stringify({
        dependencies: {
          "used-package": "1.0.0",
          "unused-package": "1.0.0",
          "script-package": "1.0.0",
          "dotenv": "1.0.0",
        },
        scripts: { build: "script-package build" },
      }),
    },
  );

  assert.deepEqual(result.suggestions.map((item) => item.name), []);
});

test("unused dependency detection suggests only fully-scanned runtime packages", () => {
  const base = [
    pkg({ name: "really-unused" }),
    pkg({ name: "dev-package", dev: true, runtime: false }),
    pkg({ name: "dotenv" }),
  ];
  const options = {
    fullCoverage: true,
    eligibleFiles: 1,
    analyzedFiles: 1,
    manifestContent: JSON.stringify({ dependencies: { "really-unused": "1.0.0" } }),
  };

  const full = findUnusedDependencies(base, [{ path: "src/app.ts", content: "export const x = 1;" }], options);
  assert.deepEqual(full.suggestions.map((item) => item.name), ["really-unused"]);

  const partial = findUnusedDependencies(base, [], { ...options, fullCoverage: false, analyzedFiles: 1, eligibleFiles: 4 });
  assert.equal(partial.suggestions.length, 0);
  assert.match(partial.warning ?? "", /skipped/i);

  const workspaces = findUnusedDependencies(base, [], {
    ...options,
    manifestContent: JSON.stringify({ workspaces: ["packages/*"], dependencies: {} }),
  });
  assert.equal(workspaces.suggestions.length, 0);
});

test("unused dependency suggestions are capped", () => {
  const packages = Array.from({ length: 9 }, (_, index) => pkg({ name: `unused-${index}` }));
  const result = findUnusedDependencies(packages, [], {
    fullCoverage: true,
    eligibleFiles: 1,
    analyzedFiles: 1,
    manifestContent: JSON.stringify({ dependencies: {} }),
  });
  assert.equal(result.suggestions.length, 5);
  assert.ok(result.warning);
});

test("dependency analysis builds vulnerability findings with ranges, fixed versions, and references", async () => {
  resetOsvCacheForTests();
  resetRegistryCacheForTests();
  const files: DependencyFile[] = [
    { path: "package.json", content: JSON.stringify({ dependencies: { lodash: "^4.17.20" } }) },
    {
      path: "package-lock.json",
      content: JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/lodash": { version: "4.17.20" } },
      }),
    },
  ];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/v1/querybatch")) return jsonResponse(batch(["GHSA-test-1234"]));
    if (String(input).includes("/v1/vulns/")) return jsonResponse(detail());
    return jsonResponse({ version: "4.17.21" });
  }) as typeof fetch;

  const result = await analyzeDependencies(files, {
    sourceFiles: [],
    fullCoverage: true,
    eligibleFiles: 0,
    analyzedFiles: 0,
    fetchImpl,
  });

  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding.source, "dependency");
  assert.equal(finding.evidenceStatus, "verified");
  assert.equal(finding.severity, "critical");
  assert.equal(finding.dependency?.name, "lodash");
  assert.equal(finding.dependency?.installedVersion, "4.17.20");
  assert.match(finding.explanation, /GHSA-test-1234|Prototype pollution/);
  assert.match(finding.evidence, /4\.17\.21/);
  assert.ok(finding.references?.some((reference) => reference.includes("osv.dev/vulnerability/GHSA-test-1234")));
});

test("dependency analysis reports outdated packages when OSV has no match", async () => {
  resetOsvCacheForTests();
  resetRegistryCacheForTests();
  const files: DependencyFile[] = [
    { path: "package.json", content: JSON.stringify({ dependencies: { lodash: "^4.17.20" } }) },
    {
      path: "package-lock.json",
      content: JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/lodash": { version: "4.17.20" } },
      }),
    },
  ];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/v1/querybatch")) return jsonResponse({ results: [{}] });
    return jsonResponse({ version: "4.17.21" });
  }) as typeof fetch;

  const result = await analyzeDependencies(files, {
    sourceFiles: [],
    fullCoverage: false,
    eligibleFiles: 10,
    analyzedFiles: 10,
    fetchImpl,
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].source, "dependency");
  assert.equal(result.findings[0].evidenceStatus, "unverified");
  assert.match(result.findings[0].title, /update available/i);
});

test("dependency analysis keeps partial results when OSV fails", async () => {
  resetOsvCacheForTests();
  resetRegistryCacheForTests();
  const files: DependencyFile[] = [
    { path: "package.json", content: JSON.stringify({ dependencies: { lodash: "^4.17.20" } }) },
    {
      path: "package-lock.json",
      content: JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/lodash": { version: "4.17.20" } },
      }),
    },
  ];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/v1/querybatch")) return jsonResponse({}, 500);
    return jsonResponse({ version: "4.17.21" });
  }) as typeof fetch;

  const result = await analyzeDependencies(files, {
    sourceFiles: [],
    fullCoverage: false,
    eligibleFiles: 10,
    analyzedFiles: 10,
    fetchImpl,
  });

  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].title, /update available/i);
  assert.ok(result.warnings.some((warning) => /OSV|lookup/i.test(warning)));
});

test("dependency analysis caps findings and skips OSV without exact versions", async () => {
  resetOsvCacheForTests();
  resetRegistryCacheForTests();
  let osvCalls = 0;
  const exactFiles: DependencyFile[] = [
    { path: "package.json", content: JSON.stringify({ dependencies: {} }) },
    { path: "package-lock.json", content: JSON.stringify({ lockfileVersion: 3, packages: {} }) },
  ];
  exactFiles[0].content = JSON.stringify({
    dependencies: Object.fromEntries(
      Array.from({ length: 16 }, (_, inner) => [`vuln-pkg-${inner}`, "1.0.0"]),
    ),
  });
  exactFiles[1].content = JSON.stringify({
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Array.from({ length: 16 }, (_, inner) => [
        `node_modules/vuln-pkg-${inner}`,
        { version: "1.0.0" },
      ]),
    ),
  });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/v1/querybatch")) {
      osvCalls++;
      const body = JSON.parse(String(init?.body)) as { queries: Array<{ package: { name: string } }> };
      return jsonResponse({
        results: body.queries.map((query) => ({ vulns: [{ id: `GHSA-${query.package.name}` }] })),
      });
    }
    if (String(input).includes("/v1/vulns/")) {
      const id = decodeURIComponent(String(input).split("/").pop() ?? "");
      const name = id.replace(/^GHSA-/, "");
      return jsonResponse(detail(id, { affected: [{ package: { ecosystem: "npm", name } }] }));
    }
    return jsonResponse({ version: "1.0.0" });
  }) as typeof fetch;

  const capped = await analyzeDependencies(exactFiles, {
    sourceFiles: [],
    fullCoverage: false,
    eligibleFiles: 10,
    analyzedFiles: 10,
    fetchImpl,
  });
  assert.equal(capped.findings.length, 12);
  assert.ok(capped.warnings.some((warning) => /limit|omitted/i.test(warning)));

  resetOsvCacheForTests();
  osvCalls = 0;
  const declaredOnly: DependencyFile[] = [
    { path: "package.json", content: JSON.stringify({ dependencies: { lodash: "^4.17.20" } }) },
  ];
  const noExact = await analyzeDependencies(declaredOnly, {
    sourceFiles: [],
    fullCoverage: false,
    eligibleFiles: 10,
    analyzedFiles: 10,
    fetchImpl: (async () => {
      osvCalls++;
      return jsonResponse({ version: "4.17.21" });
    }) as typeof fetch,
  });
  assert.equal(noExact.findings.length, 0);
  assert.ok(noExact.warnings.some((warning) => /exact|lockfile|version/i.test(warning)));
  assert.equal(osvCalls, 0);
});
