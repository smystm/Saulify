import { parse as parseYaml } from "yaml";
import type { LockParseResult, ResolvedPackage } from "@/lib/analyzer/dependencies/types";
import { isValidNpmName, isValidVersion, normalizeNpmName } from "@/lib/analyzer/dependencies/parsers/common";

type PnpmEntry = {
  name: string;
  version: string;
};

function parsePnpmKey(rawKey: string): PnpmEntry | null {
  let key = rawKey.trim();
  if (!key || key.startsWith("file:") || key.startsWith("link:") || key.startsWith("workspace:")) return null;
  if (key.startsWith("/")) key = key.slice(1);

  const peer = key.indexOf("(");
  if (peer >= 0) key = key.slice(0, peer);

  if (!key.startsWith("@") && key.includes("/")) {
    const slash = key.lastIndexOf("/");
    const name = key.slice(0, slash);
    const version = key.slice(slash + 1);
    if (isValidNpmName(name) && isValidVersion(version)) {
      return { name: normalizeNpmName(name), version };
    }
  }

  const at = key.lastIndexOf("@");
  if (at > 0) {
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (isValidNpmName(name) && isValidVersion(version)) {
      return { name: normalizeNpmName(name), version };
    }
  }

  const slash = key.lastIndexOf("/");
  if (slash > 0) {
    const name = key.slice(0, slash);
    const version = key.slice(slash + 1);
    if (isValidNpmName(name) && isValidVersion(version)) {
      return { name: normalizeNpmName(name), version };
    }
  }

  return null;
}

export function parsePnpmLock(content: string): LockParseResult {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = parseYaml(content, { maxAliasCount: 100 });
  } catch {
    return { packages: [], warnings: ["pnpm-lock.yaml could not be parsed; resolved dependency versions were skipped."] };
  }

  if (!data || typeof data !== "object") {
    return { packages: [], warnings: ["pnpm-lock.yaml had an unexpected structure; resolved dependency versions were skipped."] };
  }

  const document = data as { packages?: unknown; snapshots?: unknown };
  const source =
    document.packages && typeof document.packages === "object"
      ? document.packages
      : document.snapshots && typeof document.snapshots === "object"
        ? document.snapshots
        : null;

  if (!source) {
    warnings.push("pnpm-lock.yaml did not contain a packages section; resolved dependency versions were skipped.");
    return { packages: [], warnings };
  }

  const packages: ResolvedPackage[] = [];
  for (const [key, raw] of Object.entries(source as Record<string, unknown>)) {
    const parsed = parsePnpmKey(key);
    if (!parsed) continue;
    const dev = raw && typeof raw === "object" ? (raw as { dev?: unknown }).dev === true : false;
    packages.push({ name: parsed.name, version: parsed.version, dev });
  }

  return { packages, warnings };
}
