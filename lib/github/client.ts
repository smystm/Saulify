import { AnalysisError } from "@/lib/errors";
import type { RepoRef } from "@/lib/github/url";

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_CHARS = 12_000_000;
const MAX_FILE_CHARS = 120_000;

type FetchLike = typeof fetch;

export type RepoMetadata = {
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  issuesUrl: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  sizeKb: number;
  license: string | null;
  archived: boolean;
  pushedAt: string | null;
  language: string | null;
};

export type TreeEntry = {
  path: string;
  type: "blob" | "tree";
  size: number;
};

export type RepoTree = {
  entries: TreeEntry[];
  truncated: boolean;
};

export type FetchedFile = {
  path: string;
  content: string;
};

function headers(accept: string): HeadersInit {
  const token = process.env.GITHUB_TOKEN?.trim();
  return {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "saulify-read-only-analyzer",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function rateLimitMessage(response: Response): string {
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const minutes = Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60_000));
    return `GitHub's API rate limit was reached. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}, or configure GITHUB_TOKEN for a higher limit.`;
  }
  return "GitHub's API rate limit was reached. Try again later, or configure GITHUB_TOKEN.";
}

async function readLimitedText(response: Response, maxChars: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxChars) {
    throw new AnalysisError("GitHub returned more data than Saulify is willing to process.", 413, "response_too_large");
  }

  const text = await response.text();
  if (text.length > maxChars) {
    throw new AnalysisError("GitHub returned more data than Saulify is willing to process.", 413, "response_too_large");
  }
  return text;
}

function parseGithubJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AnalysisError(`GitHub returned malformed ${label} data.`, 502, "github_payload");
  }
}

async function githubRequest(
  path: string,
  accept: string,
  fetchImpl: FetchLike,
  maxChars = MAX_JSON_CHARS,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetchImpl(`${GITHUB_API}${path}`, {
      method: "GET",
      headers: headers(accept),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AnalysisError("GitHub did not respond in time. Please try again.", 504, "github_timeout");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new AnalysisError("GitHub request was cancelled.", 504, "github_aborted");
    }
    throw new AnalysisError("Could not reach GitHub. Check your connection and try again.", 502, "github_unreachable");
  }

  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0" || response.status === 429) {
      throw new AnalysisError(rateLimitMessage(response), 429, "github_rate_limit");
    }

    if (response.status === 404) {
      throw new AnalysisError(
        "Repository not found. Private repositories are not supported — make sure it is public and the URL is correct.",
        404,
        "repo_not_found",
      );
    }
    if (response.status === 401) {
      throw new AnalysisError(
        "GitHub rejected the server's access token. Check GITHUB_TOKEN configuration.",
        502,
        "github_auth",
      );
    }
    if (response.status === 403) {
      throw new AnalysisError(
        "GitHub refused access to this repository. It may be private or restricted.",
        403,
        "github_forbidden",
      );
    }
    if (response.status === 451) {
      throw new AnalysisError("This repository is unavailable for legal reasons.", 451, "repo_unavailable");
    }

    throw new AnalysisError(
      `GitHub returned an unexpected error (${response.status}). Please try again shortly.`,
      502,
      "github_error",
    );
  }

  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxChars) {
    throw new AnalysisError("This repository is too large for Saulify's limits.", 413, "response_too_large");
  }

  return response;
}

export async function fetchRepoMetadata(ref: RepoRef, fetchImpl: FetchLike = fetch): Promise<RepoMetadata> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`,
    "application/vnd.github+json",
    fetchImpl,
  );
  const data = parseGithubJson<{
    name?: string;
    full_name?: string;
    html_url?: string;
    description?: string | null;
    default_branch?: string;
    stargazers_count?: number;
    forks_count?: number;
    size?: number;
    license?: { spdx_id?: string | null; name?: string | null } | null;
    archived?: boolean;
    pushed_at?: string | null;
    language?: string | null;
  }>(await readLimitedText(response, MAX_JSON_CHARS), "repository metadata");

  if (!data.default_branch) {
    throw new AnalysisError("GitHub returned incomplete repository metadata.", 502, "github_payload");
  }

  return {
    owner: ref.owner,
    name: ref.name,
    fullName: ref.fullName,
    htmlUrl: ref.canonicalUrl,
    issuesUrl: `${ref.canonicalUrl}/issues`,
    description: data.description ?? null,
    defaultBranch: data.default_branch,
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    sizeKb: data.size ?? 0,
    license: data.license?.spdx_id ?? data.license?.name ?? null,
    archived: data.archived ?? false,
    pushedAt: data.pushed_at ?? null,
    language: data.language ?? null,
  };
}

export async function fetchLanguages(
  ref: RepoRef,
  fetchImpl: FetchLike = fetch,
): Promise<Array<{ name: string; bytes: number }>> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/languages`,
    "application/vnd.github+json",
    fetchImpl,
  );
  const data = parseGithubJson<Record<string, unknown>>(
    await readLimitedText(response, 500_000),
    "language",
  );
  return Object.entries(data)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([name, bytes]) => ({ name, bytes }));
}

export async function fetchRepoTree(
  ref: RepoRef,
  branch: string,
  fetchImpl: FetchLike = fetch,
): Promise<RepoTree> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    "application/vnd.github+json",
    fetchImpl,
  );
  const data = parseGithubJson<{
    tree?: Array<{ path?: string; type?: string; size?: number }>;
    truncated?: boolean;
  }>(await readLimitedText(response, MAX_JSON_CHARS), "repository tree");

  if (!Array.isArray(data.tree)) {
    throw new AnalysisError("GitHub returned an invalid repository tree.", 502, "github_payload");
  }

  return {
    entries: data.tree
      .filter(
        (entry): entry is { path: string; type: "blob" | "tree"; size: number } =>
          typeof entry.path === "string" &&
          (entry.type === "blob" || entry.type === "tree") &&
          typeof entry.size === "number",
      )
      .map((entry) => ({ path: entry.path, type: entry.type, size: entry.size })),
    truncated: data.truncated === true,
  };
}

export async function fetchFile(
  ref: RepoRef,
  branch: string,
  path: string,
  fetchImpl: FetchLike = fetch,
): Promise<FetchedFile> {
  const encodedPath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const response = await githubRequest(
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    "application/vnd.github.raw+json",
    fetchImpl,
    MAX_FILE_CHARS,
  );

  const contentType = response.headers.get("content-type") ?? "";
  const text = await readLimitedText(response, MAX_FILE_CHARS);

  if (contentType.includes("application/json") && text.trimStart().startsWith("{")) {
    try {
      const payload = JSON.parse(text) as { content?: string; encoding?: string };
      if (payload.content && payload.encoding === "base64") {
        const decoded = Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
        if (decoded.length > MAX_FILE_CHARS) {
          throw new AnalysisError("A source file exceeded the analysis size limit.", 413, "file_too_large");
        }
        return { path, content: decoded };
      }
    } catch (error) {
      if (error instanceof AnalysisError) throw error;
      // Fall through to raw text below.
    }
  }

  return { path, content: text };
}

export async function fetchFiles(
  ref: RepoRef,
  branch: string,
  paths: string[],
  fetchImpl: FetchLike = fetch,
): Promise<{ files: FetchedFile[]; skipped: number }> {
  const files: FetchedFile[] = [];
  let skipped = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < paths.length) {
      const index = cursor++;
      const path = paths[index];
      try {
        const file = await fetchFile(ref, branch, path, fetchImpl);
        if (file.content.includes("\u0000")) {
          skipped++;
          continue;
        }
        files.push(file);
      } catch (error) {
        if (error instanceof AnalysisError && error.status === 429) throw error;
        skipped++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, paths.length) }, () => worker()));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}
