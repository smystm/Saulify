import { z } from "zod";
import {
  MAX_OSV_BATCH,
  MAX_OSV_BATCH_CHARS,
  MAX_OSV_DETAIL_CACHE,
  MAX_OSV_DETAIL_CHARS,
  MAX_OSV_DETAILS,
  MAX_OSV_QUERY_CACHE,
  MAX_OSV_QUERIES,
  OSV_DEADLINE_MS,
  OSV_DETAIL_CACHE_TTL_MS,
  OSV_QUERY_CACHE_TTL_MS,
  OSV_TIMEOUT_MS,
} from "@/lib/analyzer/dependencies/limits";
import type { DependencyPackage } from "@/lib/analyzer/dependencies/types";

const OSV_API = "https://api.osv.dev";

const eventSchema = z.object({
  introduced: z.string().max(100).optional(),
  fixed: z.string().max(100).optional(),
  last_affected: z.string().max(100).optional(),
  limit: z.string().max(100).optional(),
});

const affectedSchema = z.object({
  package: z
    .object({
      ecosystem: z.string().max(100).optional(),
      name: z.string().max(214).optional(),
    })
    .optional(),
  ranges: z
    .array(
      z.object({
        type: z.string().max(50).optional(),
        events: z.array(eventSchema).max(100).optional(),
      }),
    )
    .max(100)
    .optional(),
  versions: z.array(z.string().max(100)).max(1000).optional(),
  database_specific: z.record(z.string(), z.unknown()).optional(),
});

export const osvVulnerabilitySchema = z.object({
  id: z.string().min(1).max(100),
  summary: z.string().max(2000).nullable().optional(),
  details: z.string().max(20_000).nullable().optional(),
  aliases: z.array(z.string().max(100)).max(50).optional(),
  modified: z.string().max(100).optional(),
  severity: z
    .array(
      z.object({
        type: z.string().max(50).optional(),
        score: z.string().max(500).optional(),
      }),
    )
    .max(20)
    .optional(),
  affected: z.array(affectedSchema).max(100).optional(),
  references: z
    .array(
      z.object({
        type: z.string().max(50).optional(),
        url: z.string().max(500).optional(),
      }),
    )
    .max(100)
    .optional(),
  database_specific: z.record(z.string(), z.unknown()).nullable().optional(),
});

const batchSchema = z.object({
  results: z.array(
    z.object({
      vulns: z.array(z.object({ id: z.string().min(1).max(100) })).max(1000).optional(),
    }),
  ),
});

export type OsvVulnerability = z.infer<typeof osvVulnerabilitySchema>;

export type VulnerabilityMatch = {
  package: DependencyPackage;
  vuln: OsvVulnerability;
};

type Query = {
  key: string;
  ecosystem: string;
  name: string;
  version: string;
};

type QueryCacheEntry = { at: number; ids: string[] };
type DetailCacheEntry = { at: number; vuln: OsvVulnerability };

const queryCache = new Map<string, QueryCacheEntry>();
const detailCache = new Map<string, DetailCacheEntry>();

export function resetOsvCacheForTests(): void {
  queryCache.clear();
  detailCache.clear();
}

function getQuery(key: string, now: number): string[] | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (now - entry.at > OSV_QUERY_CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  return entry.ids;
}

function setQuery(key: string, ids: string[], now: number): void {
  if (queryCache.size >= MAX_OSV_QUERY_CACHE) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  queryCache.set(key, { at: now, ids });
}

function getDetail(id: string, now: number): OsvVulnerability | null {
  const entry = detailCache.get(id);
  if (!entry) return null;
  if (now - entry.at > OSV_DETAIL_CACHE_TTL_MS) {
    detailCache.delete(id);
    return null;
  }
  return entry.vuln;
}

function setDetail(id: string, vuln: OsvVulnerability, now: number): void {
  if (detailCache.size >= MAX_OSV_DETAIL_CACHE) {
    const oldest = detailCache.keys().next().value;
    if (oldest !== undefined) detailCache.delete(oldest);
  }
  detailCache.set(id, { at: now, vuln });
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
  init: RequestInit,
  fetchImpl: typeof fetch,
  deadline: number,
  now: () => number,
): Promise<Response> {
  const remaining = deadline - now();
  if (remaining <= 0) throw new Error("deadline_exceeded");
  return fetchImpl(url, {
    ...init,
    cache: "no-store",
    headers: { "user-agent": "saulify-dependency-analyzer", ...init.headers },
    signal: AbortSignal.timeout(Math.max(1, Math.min(OSV_TIMEOUT_MS, remaining))),
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "deadline_exceeded") return "time budget was exhausted";
  if (error instanceof Error && error.name === "TimeoutError") return "request timed out";
  if (error instanceof Error && error.message === "response_too_large") return "response exceeded the size limit";
  return "request failed";
}

async function fetchDetails(
  ids: string[],
  fetchImpl: typeof fetch,
  deadline: number,
  now: () => number,
  warnings: Set<string>,
): Promise<Map<string, OsvVulnerability>> {
  const result = new Map<string, OsvVulnerability>();
  const missing: string[] = [];

  for (const id of ids) {
    const cached = getDetail(id, now());
    if (cached) result.set(id, cached);
    else missing.push(id);
  }

  let cursor = 0;
  async function worker() {
    while (cursor < missing.length) {
      const id = missing[cursor++];
      if (now() >= deadline) {
        warnings.add("OSV advisory detail limit reached; some advisories were omitted.");
        return;
      }
      try {
        const response = await request(
          `${OSV_API}/v1/vulns/${encodeURIComponent(id)}`,
          { method: "GET" },
          fetchImpl,
          deadline,
          now,
        );
        if (!response.ok) {
          warnings.add(`OSV advisory ${id} could not be retrieved and was omitted.`);
          continue;
        }
        const parsed = osvVulnerabilitySchema.safeParse(
          JSON.parse(await readLimitedText(response, MAX_OSV_DETAIL_CHARS)) as unknown,
        );
        if (!parsed.success || parsed.data.id !== id) {
          warnings.add(`OSV advisory ${id} returned invalid data and was omitted.`);
          continue;
        }
        result.set(id, parsed.data);
        setDetail(id, parsed.data, now());
      } catch (error) {
        warnings.add(`OSV advisory ${id} could not be retrieved (${errorMessage(error)}).`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, () => worker()));
  return result;
}

export async function lookupVulnerabilities(
  packages: DependencyPackage[],
  options: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    deadlineMs?: number;
  } = {},
): Promise<{ matches: VulnerabilityMatch[]; warnings: string[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? OSV_DEADLINE_MS);
  const warnings = new Set<string>();
  const byKey = new Map<string, DependencyPackage[]>();

  for (const pkg of packages) {
    if (!pkg.version) continue;
    const key = `${pkg.ecosystem}|${pkg.name}|${pkg.version}`;
    const group = byKey.get(key) ?? [];
    group.push(pkg);
    byKey.set(key, group);
  }

  const queries: Query[] = [...byKey.keys()].map((key) => {
    const [ecosystem, name, version] = key.split("|");
    return { key, ecosystem, name, version };
  });
  const capped = queries.slice(0, MAX_OSV_QUERIES);
  if (queries.length > capped.length) {
    warnings.add(
      `OSV query limit reached: ${queries.length - capped.length} packages were not checked.`,
    );
  }

  const idsByKey = new Map<string, string[]>();
  const uncached: Query[] = [];
  for (const query of capped) {
    const cached = getQuery(query.key, now());
    if (cached) idsByKey.set(query.key, cached);
    else uncached.push(query);
  }

  for (let index = 0; index < uncached.length; index += MAX_OSV_BATCH) {
    const chunk = uncached.slice(index, index + MAX_OSV_BATCH);
    if (now() >= deadline) {
      warnings.add("OSV lookup time budget was exhausted; some packages were not checked.");
      break;
    }
    try {
      const response = await request(
        `${OSV_API}/v1/querybatch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            queries: chunk.map((query) => ({
              package: { name: query.name, ecosystem: query.ecosystem },
              version: query.version,
            })),
          }),
        },
        fetchImpl,
        deadline,
        now,
      );
      if (!response.ok) {
        warnings.add(
          `OSV vulnerability lookup failed (${response.status}); dependency vulnerabilities may be incomplete.`,
        );
        continue;
      }
      const parsed = batchSchema.safeParse(
        JSON.parse(await readLimitedText(response, MAX_OSV_BATCH_CHARS)) as unknown,
      );
      if (!parsed.success || parsed.data.results.length !== chunk.length) {
        warnings.add("OSV returned an invalid vulnerability response; affected results were skipped.");
        continue;
      }
      for (let offset = 0; offset < chunk.length; offset++) {
        const ids = (parsed.data.results[offset].vulns ?? []).map((vuln) => vuln.id);
        idsByKey.set(chunk[offset].key, ids);
        setQuery(chunk[offset].key, ids, now());
      }
    } catch (error) {
      warnings.add(`OSV vulnerability lookup failed (${errorMessage(error)}).`);
    }
  }

  const uniqueIds = [...new Set([...idsByKey.values()].flat())];
  const selectedIds = uniqueIds.slice(0, MAX_OSV_DETAILS);
  if (uniqueIds.length > selectedIds.length) {
    warnings.add(
      `OSV advisory limit reached: ${uniqueIds.length - selectedIds.length} advisories were not checked.`,
    );
  }

  const details = await fetchDetails(selectedIds, fetchImpl, deadline, now, warnings);
  const matches: VulnerabilityMatch[] = [];
  const seen = new Set<string>();

  for (const query of capped) {
    const group = byKey.get(query.key) ?? [];
    for (const id of idsByKey.get(query.key) ?? []) {
      const vuln = details.get(id);
      if (!vuln) continue;
      for (const pkg of group) {
        const key = `${pkg.ecosystem}|${pkg.name}|${pkg.version}|${id}|${pkg.manifest}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ package: pkg, vuln });
      }
    }
  }

  return { matches, warnings: [...warnings] };
}
