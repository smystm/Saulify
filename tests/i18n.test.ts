import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { en } from "../lib/i18n/en";
import { fa } from "../lib/i18n/fa";
import { directionFor, isLocale, normalizeLocale } from "../lib/i18n";

function shape(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return [`${prefix}:${typeof value}`];
  }
  if (Array.isArray(value)) {
    return [`${prefix}:array:${value.length}`, ...value.flatMap((item, index) => shape(item, `${prefix}[${index}]`))];
  }
  return Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, item]) => shape(item, `${prefix}.${key}`));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

test("English and Persian dictionaries have the same typed shape", () => {
  assert.deepEqual(shape(fa), shape(en));
  assert.equal(fa.home.steps.length, en.home.steps.length);
  assert.equal(fa.home.how.cards.length, en.home.how.cards.length);
  assert.equal(fa.home.trust.length, en.home.trust.length);
  assert.equal(en.features.capabilities.length, 4);
  assert.equal(fa.features.capabilities.length, 4);
  assert.deepEqual(
    fa.features.capabilities.map((capability) => capability.points.length),
    [3, 3, 3, 3],
  );
});

test("Persian dictionary contains translated report and error copy", () => {
  assert.match(fa.report.reviewSummary, /[\u0600-\u06FF]/);
  assert.match(fa.report.submit.title, /[\u0600-\u06FF]/);
  assert.match(fa.home.errors.invalidUrl, /[\u0600-\u06FF]/);
  assert.match(fa.home.apiErrors.repo_not_found, /[\u0600-\u06FF]/);
  assert.match(fa.features.title, /[\u0600-\u06FF]/);
  assert.match(fa.features.capabilities[0].title, /[\u0600-\u06FF]/);
  assert.match(fa.onboarding.skip, /[\u0600-\u06FF]/);
  assert.match(fa.onboarding.progress("۱", "۴"), /[\u0600-\u06FF]/);
  assert.match(
    fa.report.summary({
      total: "۲",
      files: "۴",
      critical: "۰",
      high: "۱",
      medium: "۱",
      low: "۰",
      verified: "۱",
      hypotheses: "۱",
      ai: false,
    }),
    /[\u0600-\u06FF]/,
  );
});

test("locale helpers default to English and set Persian RTL", () => {
  assert.equal(normalizeLocale("fa"), "fa");
  assert.equal(normalizeLocale("de"), "en");
  assert.equal(normalizeLocale(undefined), "en");
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("xx"), false);
  assert.equal(directionFor("en"), "ltr");
  assert.equal(directionFor("fa"), "rtl");
});

test("Persian UI strings live only in lib/i18n/fa.ts", () => {
  const roots = ["app", "components", "lib"].map((directory) => join(process.cwd(), directory));
  const faPath = join(process.cwd(), "lib", "i18n", "fa.ts");
  const offenders = roots
    .flatMap(sourceFiles)
    .filter((path) => path !== faPath)
    .filter((path) => /[\u0600-\u06FF]/.test(readFileSync(path, "utf8")))
    .map((path) => relative(process.cwd(), path));

  assert.deepEqual(offenders, []);
});
