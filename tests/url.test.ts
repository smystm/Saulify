import test from "node:test";
import assert from "node:assert/strict";
import { parseGitHubRepoUrl } from "../lib/github/url";

test("normalizes valid GitHub repository URLs", () => {
  const variants = [
    "https://github.com/expressjs/express",
    "https://github.com/expressjs/express/",
    "https://www.github.com/expressjs/express",
    "github.com/expressjs/express",
    "https://github.com/expressjs/express.git",
  ];

  for (const input of variants) {
    const result = parseGitHubRepoUrl(input);
    assert.equal(result.owner, "expressjs");
    assert.equal(result.name, "express");
    assert.equal(result.canonicalUrl, "https://github.com/expressjs/express");
  }
});

test("rejects non-GitHub and malformed URLs", () => {
  const invalid = [
    "",
    "not a url",
    "http://github.com/expressjs/express",
    "https://github.com.evil.example/expressjs/express",
    "https://github.com@evil.example/expressjs/express",
    "https://user:pass@github.com/expressjs/express",
    "https://github.com:8443/expressjs/express",
    "https://github.com/expressjs/express/tree/main",
    "https://github.com/expressjs/express?tab=readme",
    "https://github.com/expressjs/express#readme",
    "https://gitlab.com/expressjs/express",
    "https://github.com/only-owner",
    "https://github.com/../express",
  ];

  for (const input of invalid) {
    assert.throws(() => parseGitHubRepoUrl(input), /GitHub|URL|repository|HTTPS|invalid|owner|query|port/i, input);
  }
});

test("never trusts a user-supplied API host", () => {
  const parsed = parseGitHubRepoUrl("https://github.com/owner/repo");
  assert.equal(parsed.canonicalUrl, "https://github.com/owner/repo");
  assert.equal(parsed.fullName, "owner/repo");
});
