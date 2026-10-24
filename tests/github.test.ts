import test from "node:test";
import assert from "node:assert/strict";
import { fetchRepoMetadata } from "../lib/github/client";
import { parseGitHubRepoUrl } from "../lib/github/url";
import { AnalysisError } from "../lib/errors";

const ref = parseGitHubRepoUrl("https://github.com/owner/repo");

function mockResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("maps a missing or private repository to a useful 404 message", async () => {
  const fetchImpl = (async () => mockResponse(404, JSON.stringify({ message: "Not Found" }))) as typeof fetch;
  await assert.rejects(
    fetchRepoMetadata(ref, fetchImpl),
    (error: unknown) =>
      error instanceof AnalysisError &&
      error.status === 404 &&
      /private repositories are not supported/i.test(error.message),
  );
});

test("surfaces GitHub rate limits without retrying blindly", async () => {
  const fetchImpl = (async () =>
    mockResponse(403, JSON.stringify({ message: "rate limit" }), {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 120),
    })) as typeof fetch;

  await assert.rejects(
    fetchRepoMetadata(ref, fetchImpl),
    (error: unknown) =>
      error instanceof AnalysisError && error.status === 429 && /rate limit/i.test(error.message),
  );
});

test("maps network timeouts to a retryable error", async () => {
  const fetchImpl = (async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    throw timeout;
  }) as typeof fetch;

  await assert.rejects(
    fetchRepoMetadata(ref, fetchImpl),
    (error: unknown) =>
      error instanceof AnalysisError && error.status === 504 && /respond in time/i.test(error.message),
  );
});

test("maps malformed GitHub payloads to a 502 instead of crashing", async () => {
  const fetchImpl = (async () => mockResponse(200, "<html>not json</html>")) as typeof fetch;
  await assert.rejects(
    fetchRepoMetadata(ref, fetchImpl),
    (error: unknown) =>
      error instanceof AnalysisError && error.status === 502 && /malformed/i.test(error.message),
  );
});

test("normalizes successful repository metadata", async () => {
  const fetchImpl = (async () =>
    mockResponse(
      200,
      JSON.stringify({
        name: "repo",
        full_name: "owner/repo",
        html_url: "https://github.com/owner/repo",
        description: "A test repository",
        default_branch: "main",
        stargazers_count: 12,
        forks_count: 3,
        size: 1024,
        license: { spdx_id: "MIT" },
        archived: false,
        pushed_at: "2026-01-01T00:00:00Z",
        language: "TypeScript",
      }),
    )) as typeof fetch;

  const metadata = await fetchRepoMetadata(ref, fetchImpl);
  assert.equal(metadata.fullName, "owner/repo");
  assert.equal(metadata.defaultBranch, "main");
  assert.equal(metadata.issuesUrl, "https://github.com/owner/repo/issues");
  assert.equal(metadata.license, "MIT");
});
