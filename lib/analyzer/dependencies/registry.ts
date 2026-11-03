import { z } from "zod";
import {
  MAX_OUTDATED_CHECKS_PER_ECOSYSTEM,
  MAX_REGISTRY_CACHE,
  MAX_REGISTRY_RESPONSE_CHARS,
  REGISTRY_CACHE_TTL_MS,
  REGISTRY_DEADLINE_MS,
  REGISTRY_TIMEOUT_MS,
} from "@/lib/analyzer/dependencies/limits";
import type { DependencyPackage } from "@/lib/analyzer/dependencies/types";

const npmSchema = z.object({ version: z.string().min(1).max(100) });
const pypiSchema = z.object({ info: z.object({ version: z.string().min(1).max(100) }) });

type CacheEntry = { at: number; version: string };

const cache = new Map<string, CacheEntry>();

export function resetRegistryCacheForTests(): void {
  cache.clear();
}

export function isOutdatedVersion(installed: string, latest: string): boolean {
  const pattern = /^(\d+(?:\.\d+){0,3})([-+].*)?$/;
  const installedMatch = installed.match(pattern);
  const latestMatch = latest.match(pattern);
  if (!installedMatch || !latestMatch) return false;

  const installedParts = installedMatch[1].split(".").map(Number);
  const latestParts = latestMatch[1].split(".").map(Number);
  const length = Math.max(installedParts.length, latestParts.length);
  for (let index = 0; index < length; index++) {
    const left = installedParts[index] ?? 0;
    const right = latestParts[index] ?? 0;
    if (left < right) return true;
    if (left > right) return false;
  }

  const installedPrerelease = Boolean(installedMatch[2]?.startsWith("-"));
  const latestPrerelease = Boolean(latestMatch[2]?.startsWith("-"));
  return installedPrerelease && !latestPrerelease;
}

function getCached(key: string, now: number): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.at > REGISTRY_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.version;
}

function setCached(key: string, version: string, now: number): void {
  if (cache.size >= MAX_REGISTRY_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, version });
}

async function readLimitedText(response: Response, maxChars: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxChars) throw new Error("response_too_large");
  const text = await response.text();
  if (text.length > maxChars) throw new Error("response_too_large");
  return text;
}

async function request(
  url: string,
  fetchImpl: typeof fetch,
  deadline: number,
  now: () => number,
): Promise<Response> {
  const remaining = deadline - now();
  if (remaining <= 0) throw new Error("deadline_exceeded");
  return fetchImpl(url, {
    method: "GET",
    cache: "no-store",
    headers: { "user-agent": "saulify-dependency-analyzer" },
    signal: AbortSignal.timeout(Math.max(1, Math.min(REGISTRY_TIMEOUT_MS, remaining))),
  });
}

export async function lookupLatestVersions(
  packages: DependencyPackage[],
  options: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    deadlineMs?: number;
  } = {},
): Promise<{ versions: Map<string, string>; warnings: string[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? REGISTRY_DEADLINE_MS);
  const versions = new Map<string, string>();
  const warnings: string[] = [];

  const selected: DependencyPackage[] = [];
  const seen = new Set<string>();
  const counts = { npm: 0, PyPI: 0 };
  let omitted = 0;
  for (const pkg of packages) {
    if (!pkg.direct || !pkg.version) continue;
    const key = `${pkg.ecosystem}|${pkg.name}`;
    if (seen.has(key)) continue;
    if (counts[pkg.ecosystem] >= MAX_OUTDATED_CHECKS_PER_ECOSYSTEM) {
      omitted++;
      continue;
    }
    seen.add(key);
    counts[pkg.ecosystem]++;
    selected.push(pkg);
  }
  if (omitted > 0) {
    warnings.push(
      `Outdated dependency checks were limited to ${MAX_OUTDATED_CHECKS_PER_ECOSYSTEM} packages per ecosystem; ${omitted} were not checked.`,
    );
  }

  const missing: DependencyPackage[] = [];
  for (const pkg of selected) {
    const key = `${pkg.ecosystem}|${pkg.name}`;
    const cached = getCached(key, now());
    if (cached) versions.set(key, cached);
    else missing.push(pkg);
  }

  let failures = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < missing.length) {
      const pkg = missing[cursor++];
      const key = `${pkg.ecosystem}|${pkg.name}`;
      if (now() >= deadline) {
        failures++;
        continue;
      }
      const url =
        pkg.ecosystem === "npm"
          ? `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/latest`
          : `https://pypi.org/pypi/${encodeURIComponent(pkg.name)}/json`;
      try {
        const response = await request(url, fetchImpl, deadline, now);
        if (!response.ok) {
          failures++;
          continue;
        }
        const text = await readLimitedText(response, MAX_REGISTRY_RESPONSE_CHARS);
        const raw = JSON.parse(text) as unknown;
        const parsed = pkg.ecosystem === "npm" ? npmSchema.safeParse(raw) : pypiSchema.safeParse(raw);
        if (!parsed.success) {
          failures++;
          continue;
        }
        const version =
          pkg.ecosystem === "npm"
            ? (parsed.data as { version: string }).version
            : (parsed.data as { info: { version: string } }).info.version;
        const trimmed = version.trim();
        if (!/^[0-9a-z][0-9a-z.+!_~-]{0,63}$/i.test(trimmed)) {
          failures++;
          continue;
        }
        versions.set(key, trimmed);
        setCached(key, trimmed, now());
      } catch {
        failures++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, () => worker()));
  if (failures > 0) {
    warnings.push(`Outdated dependency checks failed for ${failures} package${failures === 1 ? "" : "s"}.`);
  }

  return { versions, warnings };
}
