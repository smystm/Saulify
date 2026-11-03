import test from "node:test";
import assert from "node:assert/strict";
import { planDependencyFiles } from "../lib/analyzer/dependencies/files";
import { parseNpmProject } from "../lib/analyzer/dependencies/parsers/npm";
import { parsePythonProject } from "../lib/analyzer/dependencies/parsers/python";
import type { DependencyFile } from "../lib/analyzer/dependencies/types";
import type { TreeEntry } from "../lib/github/client";

function entry(path: string, size = 1_000): TreeEntry {
  return { path, type: "blob", size };
}

function file(path: string, content: string): DependencyFile {
  return { path, content };
}

function packageAt(result: ReturnType<typeof parseNpmProject>, name: string) {
  return result.packages.find((pkg) => pkg.name === name);
}

test("dependency file selection prefers lockfiles and caps the file set", () => {
  const plan = planDependencyFiles([
    entry("package.json"),
    entry("package-lock.json", 10_000),
    entry("pnpm-lock.yaml", 10_000),
    entry("requirements.txt"),
    entry("poetry.lock", 10_000),
    entry("src/app.ts"),
  ]);

  assert.deepEqual(plan.paths, [
    "package.json",
    "package-lock.json",
    "poetry.lock",
    "requirements.txt",
  ]);
  assert.ok(plan.warnings.some((warning) => /multiple npm lockfiles/i.test(warning)));
});

test("dependency file selection warns about nested manifests and skips oversized files", () => {
  const plan = planDependencyFiles([
    entry("package.json"),
    entry("package-lock.json", 1_500_000),
    entry("web/package.json"),
  ]);

  assert.deepEqual(plan.paths, ["package.json"]);
  assert.ok(plan.warnings.some((warning) => /size limit/i.test(warning)));
  assert.ok(plan.warnings.some((warning) => /root-level/i.test(warning)));
});

test("npm package-lock v3 merges exact versions with declared ranges", () => {
  const result = parseNpmProject([
    file(
      "package.json",
      JSON.stringify({
        dependencies: { lodash: "^4.17.20", express: "^4.18.2" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    ),
    file(
      "package-lock.json",
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "app" },
          "node_modules/lodash": { version: "4.17.20" },
          "node_modules/express": { version: "4.18.2" },
          "node_modules/typescript": { version: "5.4.5", dev: true },
          "node_modules/express/node_modules/cookie": { version: "0.5.0" },
          "node_modules/local-link": { link: true },
        },
      }),
    ),
  ]);

  assert.equal(result.warnings.length, 0);
  const lodash = packageAt(result, "lodash");
  assert.equal(lodash?.version, "4.17.20");
  assert.equal(lodash?.declaredRange, "^4.17.20");
  assert.equal(lodash?.direct, true);
  assert.equal(lodash?.dev, false);
  assert.equal(lodash?.manifest, "package-lock.json");

  const typescript = packageAt(result, "typescript");
  assert.equal(typescript?.dev, true);
  assert.equal(typescript?.direct, true);

  const cookie = packageAt(result, "cookie");
  assert.equal(cookie?.direct, false);
  assert.equal(result.packages.some((pkg) => pkg.name === "local-link"), false);
});

test("npm package-lock v1 walks nested dependency trees", () => {
  const result = parseNpmProject([
    file("package.json", JSON.stringify({ dependencies: { lodash: "^4.17.21" } })),
    file(
      "package-lock.json",
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          lodash: { version: "4.17.21" },
          nested: {
            version: "1.0.0",
            dependencies: { child: { version: "2.0.0" } },
          },
        },
      }),
    ),
  ]);

  assert.equal(packageAt(result, "lodash")?.direct, true);
  assert.equal(packageAt(result, "nested")?.version, "1.0.0");
  assert.equal(packageAt(result, "child")?.version, "2.0.0");
});

test("pnpm v9 lockfile reads importers and package keys", () => {
  const result = parseNpmProject([
    file(
      "package.json",
      JSON.stringify({
        dependencies: { lodash: "^4.17.20" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    ),
    file(
      "pnpm-lock.yaml",
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "    dependencies:",
        "      lodash:",
        "        specifier: ^4.17.20",
        "        version: 4.17.21",
        "    devDependencies:",
        "      typescript:",
        "        specifier: ^5.0.0",
        "        version: 5.4.5",
        "packages:",
        "  lodash@4.17.21:",
        "    resolution: {integrity: sha512-x}",
        "  '@types/node@20.0.0': {}",
        "snapshots:",
        "  lodash@4.17.21: {}",
      ].join("\n"),
    ),
  ]);

  assert.equal(packageAt(result, "lodash")?.version, "4.17.21");
  assert.equal(packageAt(result, "lodash")?.declaredRange, "^4.17.20");
  assert.equal(packageAt(result, "typescript")?.dev, true);
  assert.equal(packageAt(result, "@types/node")?.direct, false);
});

test("pnpm slash and @ package keys are both supported", () => {
  const slash = parseNpmProject([
    file("pnpm-lock.yaml", ["lockfileVersion: 5.4", "packages:", "  /lodash/4.17.21: {}", "  /@scope/pkg/1.2.3: {}"].join("\n")),
  ]);
  assert.equal(packageAt(slash, "lodash")?.version, "4.17.21");
  assert.equal(packageAt(slash, "@scope/pkg")?.version, "1.2.3");

  const at = parseNpmProject([
    file("pnpm-lock.yaml", ["lockfileVersion: 6.0", "packages:", "  /lodash@4.17.21: {}", "  /@scope/pkg@1.2.3: {}"].join("\n")),
  ]);
  assert.equal(packageAt(at, "lodash")?.version, "4.17.21");
  assert.equal(packageAt(at, "@scope/pkg")?.version, "1.2.3");
});

test("yarn v1 and Berry lockfiles resolve exact versions", () => {
  const v1 = parseNpmProject([
    file(
      "yarn.lock",
      ['# yarn lockfile v1', "", "lodash@^4.17.20:", '  version "4.17.20"', "", '"@scope/pkg@^1.0.0":', '  version "1.2.3"'].join(
        "\n",
      ),
    ),
  ]);
  assert.equal(packageAt(v1, "lodash")?.version, "4.17.20");
  assert.equal(packageAt(v1, "@scope/pkg")?.version, "1.2.3");

  const berry = parseNpmProject([
    file(
      "yarn.lock",
      [
        "__metadata:",
        "  version: 8",
        '"lodash@npm:^4.17.20":',
        "  version: 4.17.21",
        '  resolution: "lodash@npm:4.17.21"',
        '"@scope/pkg@npm:^1.0.0":',
        "  version: 1.2.3",
        '  resolution: "@scope/pkg@npm:1.2.3"',
      ].join("\n"),
    ),
  ]);
  assert.equal(packageAt(berry, "lodash")?.version, "4.17.21");
  assert.equal(packageAt(berry, "@scope/pkg")?.version, "1.2.3");
});

test("npm parsers degrade safely on malformed or oversized input", () => {
  const malformed = parseNpmProject([
    file("package.json", "{not json"),
    file("package-lock.json", "{not json"),
  ]);
  assert.equal(malformed.packages.length, 0);
  assert.ok(malformed.warnings.length >= 2);

  const oversized = parseNpmProject([
    file(
      "package-lock.json",
      JSON.stringify({
        lockfileVersion: 3,
        packages: Object.fromEntries(
          Array.from({ length: 260 }, (_, index) => [`node_modules/pkg-${index}`, { version: "1.0.0" }]),
        ),
      }),
    ),
  ]);
  assert.equal(oversized.packages.length, 200);
  assert.ok(oversized.warnings.some((warning) => /limit/i.test(warning)));
});

test("requirements.txt extracts pins, ranges, markers, hashes, and includes", () => {
  const result = parsePythonProject([
    file(
      "requirements.txt",
      [
        "# runtime",
        "Django==4.2.11",
        'requests[socks]==2.31.0 ; python_version >= "3.8"',
        "flask>=2.0,<3.0",
        "-r other.txt",
        "--index-url https://example.com/simple",
        "sqlalchemy===1.4.0 --hash=sha256:abc",
        "urllib3==2.0.0 \\",
        "    --hash=sha256:def",
        "local-path @ file:///tmp/pkg",
      ].join("\n"),
    ),
  ]);

  assert.equal(result.warnings.some((warning) => /nested requirement/i.test(warning)), true);
  const byName = new Map(result.packages.map((pkg) => [pkg.name, pkg]));
  assert.deepEqual(
    [...byName.keys()].sort(),
    ["django", "flask", "requests", "sqlalchemy", "urllib3"],
  );
  assert.deepEqual(
    ["django", "requests", "flask", "sqlalchemy", "urllib3"].map((name) => {
      const pkg = byName.get(name);
      return [pkg?.name, pkg?.version, pkg?.declaredRange];
    }),
    [
      ["django", "4.2.11", "==4.2.11"],
      ["requests", "2.31.0", "==2.31.0"],
      ["flask", null, ">=2.0,<3.0"],
      ["sqlalchemy", "1.4.0", "===1.4.0"],
      ["urllib3", "2.0.0", "==2.0.0"],
    ],
  );
});

test("Python lockfiles merge exact versions with requirement ranges", () => {
  const result = parsePythonProject([
    file("requirements.txt", "Django==4.2.11\n"),
    file(
      "poetry.lock",
      [
        "[[package]]",
        'name = "django"',
        'version = "4.2.11"',
        'category = "main"',
        "",
        "[package.dependencies]",
        'asgiref = ">=3.6"',
        "",
        "[[package]]",
        'name = "asgiref"',
        'version = "3.7.2"',
        'category = "main"',
        "",
        "[[package]]",
        'name = "pytest"',
        'version = "8.0.0"',
        'category = "dev"',
      ].join("\n"),
    ),
  ]);

  const django = result.packages.find((pkg) => pkg.name === "django");
  assert.equal(django?.version, "4.2.11");
  assert.equal(django?.direct, true);
  assert.equal(django?.declaredRange, "==4.2.11");
  assert.equal(result.packages.find((pkg) => pkg.name === "asgiref")?.direct, false);
  assert.equal(result.packages.find((pkg) => pkg.name === "pytest")?.dev, true);
});

test("Pipfile.lock and uv/pdm style TOML packages are supported", () => {
  const pipfile = parsePythonProject([
    file(
      "Pipfile.lock",
      JSON.stringify({
        default: { django: { version: "==4.2.11" }, local: { path: "." } },
        develop: { pytest: { version: "==8.0.0" } },
      }),
    ),
  ]);
  assert.equal(pipfile.packages.find((pkg) => pkg.name === "django")?.version, "4.2.11");
  assert.equal(pipfile.packages.find((pkg) => pkg.name === "pytest")?.dev, true);
  assert.equal(pipfile.packages.some((pkg) => pkg.name === "local"), false);

  const uv = parsePythonProject([
    file(
      "uv.lock",
      ['version = 1', "", "[[package]]", 'name = "requests"', 'version = "2.31.0"', 'source = { registry = "https://pypi.org/simple" }'].join(
        "\n",
      ),
    ),
  ]);
  assert.equal(uv.packages[0]?.name, "requests");
  assert.equal(uv.packages[0]?.version, "2.31.0");

  const pdm = parsePythonProject([
    file("pdm.lock", ['[[package]]', 'name = "flask"', 'version = "3.0.0"'].join("\n")),
  ]);
  assert.equal(pdm.packages[0]?.name, "flask");
  assert.equal(pdm.packages[0]?.version, "3.0.0");
});

test("Python parsing normalizes names and rejects malformed versions", () => {
  const result = parsePythonProject([
    file("requirements.txt", "Django==4.2.11\nbad-package==not a version\n"),
  ]);

  assert.equal(result.packages.find((pkg) => pkg.name === "django")?.version, "4.2.11");
  assert.equal(result.packages.some((pkg) => pkg.name === "bad-package"), false);
  assert.ok(result.warnings.some((warning) => /version/i.test(warning)));
});
