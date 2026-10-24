export type RepoRef = {
  owner: string;
  name: string;
  fullName: string;
  canonicalUrl: string;
};

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * Accepts only public-repository-shaped GitHub URLs. Every network URL used
 * later is rebuilt from the owner/name pair, so arbitrary hosts and paths can
 * never become SSRF targets.
 */
export function parseGitHubRepoUrl(input: string): RepoRef {
  const raw = input.trim();

  if (!raw || raw.length > 500) {
    throw new Error("Enter a GitHub repository URL.");
  }

  if (/\s/.test(raw)) {
    throw new Error("Repository URLs cannot contain spaces.");
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Use an HTTPS GitHub URL.");
  }

  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not accepted.");
  }

  if (url.port) {
    throw new Error("Custom ports are not accepted.");
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error("Only github.com repository URLs are supported.");
  }

  if (url.search || url.hash) {
    throw new Error("Remove query strings and fragments from the repository URL.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new Error("Use a repository root URL, for example https://github.com/owner/repo.");
  }

  let owner: string;
  let name: string;

  try {
    owner = decodeURIComponent(segments[0]);
    name = decodeURIComponent(segments[1]).replace(/\.git$/i, "");
  } catch {
    throw new Error("The repository URL contains invalid encoding.");
  }

  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(name) || name === "." || name === "..") {
    throw new Error("The GitHub owner or repository name is invalid.");
  }

  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    canonicalUrl: `https://github.com/${owner}/${name}`,
  };
}
