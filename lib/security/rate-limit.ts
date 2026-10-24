type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_CLIENTS = 5_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
};

export function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate =
    forwarded ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local";
  return candidate.slice(0, 100);
}

/**
 * Best-effort in-memory limiter. It protects a single instance, not a whole
 * serverless fleet; a distributed store is required for fleet-wide quotas.
 */
export function checkRateLimit(
  key: string,
  options: { limit?: number; windowMs?: number; now?: number } = {},
): RateLimitResult {
  const limit = options.limit ?? 5;
  const windowMs = options.windowMs ?? 10 * 60_000;
  const now = options.now ?? Date.now();

  if (buckets.size > MAX_TRACKED_CLIENTS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
    if (buckets.size > MAX_TRACKED_CLIENTS) {
      const oldest = buckets.keys().next().value;
      if (oldest) buckets.delete(oldest);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: 0,
      resetAt: now + windowMs,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      resetAt: existing.resetAt,
    };
  }

  existing.count++;
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: 0,
    resetAt: existing.resetAt,
  };
}
