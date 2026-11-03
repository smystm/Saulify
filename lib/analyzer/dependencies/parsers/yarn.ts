import { parse as parseYaml } from "yaml";
import type { LockParseResult, ResolvedPackage } from "@/lib/analyzer/dependencies/types";
import { isValidNpmName, isValidVersion, normalizeNpmName } from "@/lib/analyzer/dependencies/parsers/common";

function splitSelector(selector: string): { name: string; version: string } | null {
  const value = selector.trim().replace(/^"|"$/g, "");
  if (!value || value.startsWith("workspace:") || value.startsWith("file:") || value.startsWith("link:")) {
    return null;
  }
  const at = value.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: value.slice(0, at), version: value.slice(at + 1) };
}

function parseBerryResolution(resolution: string): { name: string; version: string } | null {
  const marker = resolution.lastIndexOf("@npm:");
  if (marker <= 0) return null;
  const name = resolution.slice(0, marker);
  let version = resolution.slice(marker + "@npm:".length);
  const peer = version.indexOf("(");
  if (peer >= 0) version = version.slice(0, peer);
  return { name, version };
}

function parseBerry(content: string): LockParseResult {
  let data: unknown;
  try {
    data = parseYaml(content, { maxAliasCount: 100 });
  } catch {
    return { packages: [], warnings: ["yarn.lock could not be parsed; resolved dependency versions were skipped."] };
  }

  if (!data || typeof data !== "object") {
    return { packages: [], warnings: ["yarn.lock had an unexpected structure; resolved dependency versions were skipped."] };
  }

  const packages: ResolvedPackage[] = [];
  for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
    if (key === "__metadata" || !raw || typeof raw !== "object") continue;
    const entry = raw as { version?: unknown; resolution?: unknown };
    const fromResolution =
      typeof entry.resolution === "string" ? parseBerryResolution(entry.resolution) : null;
    const keyMarker = key.lastIndexOf("@npm:");
    const fromKey =
      keyMarker > 0 && typeof entry.version === "string"
        ? { name: key.slice(0, keyMarker), version: entry.version }
        : null;
    const candidate = fromResolution ?? fromKey;
    if (!candidate) continue;
    const version =
      typeof entry.version === "string" ? entry.version.trim() : candidate.version;
    const name = normalizeNpmName(candidate.name);
    if (!isValidNpmName(name) || !isValidVersion(version)) continue;
    packages.push({ name, version, dev: false });
  }

  return { packages, warnings: [] };
}

function parseClassic(content: string): LockParseResult {
  const packages: ResolvedPackage[] = [];
  let current: { name: string; version: string } | null = null;

  const flush = () => {
    if (!current) return;
    const name = normalizeNpmName(current.name);
    if (isValidNpmName(name) && isValidVersion(current.version)) {
      packages.push({ name, version: current.version, dev: false });
    }
    current = null;
  };

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line) && line.trimEnd().endsWith(":")) {
      flush();
      const header = line.trimEnd().slice(0, -1);
      const first = header.match(/^"([^"]+)"|^([^,\s]+)/);
      const selector = first?.[1] ?? first?.[2];
      if (!selector) continue;
      current = splitSelector(selector);
      continue;
    }
    if (current) {
      const version = line.match(/^\s+version\s+"([^"]+)"/);
      if (version) current.version = version[1];
    }
  }
  flush();

  return { packages, warnings: [] };
}

export function parseYarnLock(content: string): LockParseResult {
  return content.trimStart().startsWith("__metadata:") ? parseBerry(content) : parseClassic(content);
}
