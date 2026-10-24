import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, getClientIdentifier } from "../lib/security/rate-limit";

test("rate limiter allows the configured budget and then blocks", () => {
  const key = `client-${Math.random()}`;
  const first = checkRateLimit(key, { limit: 2, windowMs: 1_000, now: 10_000 });
  const second = checkRateLimit(key, { limit: 2, windowMs: 1_000, now: 10_100 });
  const third = checkRateLimit(key, { limit: 2, windowMs: 1_000, now: 10_200 });

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSeconds > 0);
});

test("rate limiter resets after its window", () => {
  const key = `client-${Math.random()}`;
  checkRateLimit(key, { limit: 1, windowMs: 1_000, now: 1_000 });
  const blocked = checkRateLimit(key, { limit: 1, windowMs: 1_000, now: 1_500 });
  assert.equal(blocked.allowed, false);

  const reset = checkRateLimit(key, { limit: 1, windowMs: 1_000, now: 2_100 });
  assert.equal(reset.allowed, true);
});

test("uses the first forwarded address for rate-limit identity", () => {
  const request = new Request("https://example.com", {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
  });
  assert.equal(getClientIdentifier(request), "203.0.113.9");
});
