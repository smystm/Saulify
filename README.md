# Saulify

Saulify is an open-source, read-only GitHub repository analyzer. Paste a public repository URL and get an evidence-based review of potential bugs and security issues, with copy-ready GitHub issue drafts and manual submission instructions.

**Saulify never modifies repositories, executes repository code, creates issues, or opens pull requests.**

## What it does

- Validates public GitHub repository URLs and rejects arbitrary hosts, paths, credentials, and ports.
- Reads repository metadata, the default branch, languages, and a capped selection of source files through the GitHub REST API.
- Runs deterministic static rules over JS/TS and Python, plus cross-language credential and private-key checks. Selected YAML/config files are scanned for those credential patterns as well.
- Optionally asks an AI provider for additional findings. The response must pass strict Zod validation, unknown file paths are dropped, line ranges are clamped, and quoted evidence is checked against fetched source.
- Deduplicates findings and labels each one as a **static rule** or **AI reviewed**, and as **evidence matched** or **unverified hypothesis**.
- Provides severity filters, confidence, file/line references, evidence, remediation direction, a GitHub issue title/body, copy buttons, a direct link to the repository's Issues page, and manual submission steps.

Reports are stored in the browser session (`sessionStorage`) by design. No database or account is required.

## Stack

- Next.js 16 App Router, React 19, TypeScript
- Tailwind CSS 4
- Zod for input, AI-output, and report schemas
- GitHub REST API via native `fetch`
- Node test runner through `tsx`

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app works without any environment variables. It uses unauthenticated GitHub requests and deterministic static analysis only. API limits are low; configure `GITHUB_TOKEN` for normal use and an AI provider for additional review.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | No | Server-side GitHub token. Raises the REST quota from 60 to 5,000 requests/hour. Never use a `NEXT_PUBLIC_` prefix. |
| `MAX_REPO_SIZE_MB` | No | Repository size safety limit. Default `250`. |
| `AI_PROVIDER` | No | `auto`, `opencode`, `openai-compatible`, `ollama`, or `off`. Default `auto`. |
| `AI_MODEL` | For hosted AI | Model identifier accepted by the selected provider. |
| `OPENCODE_API_KEY` | For OpenCode Zen | Server-side API key. |
| `OPENCODE_BASE_URL` | No | Defaults to `https://opencode.ai/zen/v1`. |
| `AI_BASE_URL` | For generic provider | OpenAI-compatible API base URL, usually ending in `/v1`. |
| `AI_API_KEY` | No | Bearer token for the generic provider, if required. |
| `OLLAMA_BASE_URL` | For auto Ollama | Example: `http://127.0.0.1:11434`. |
| `OLLAMA_MODEL` | For Ollama | Local model tag, for example a code-focused model you have pulled. |

### OpenCode Zen

```env
AI_PROVIDER=opencode
OPENCODE_API_KEY=your_server_side_key
AI_MODEL=the_model_identifier_available_to_your_account
```

Select a model string from the models available to your OpenCode account. Free-model availability changes over time; Saulify does not hardcode model names.

### Generic OpenAI-compatible endpoint

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://provider.example/v1
AI_API_KEY=your_key
AI_MODEL=model-name
```

### Local Ollama

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:7b
```

Ollama is called through its local chat API from the server. If the app runs in a container, `127.0.0.1` points at the container, not the host.

If AI configuration is missing or a provider request fails, the analysis still completes with static findings. The report explicitly shows the degraded mode and warning.

## Safety model

- **No execution:** source is only fetched and parsed as text. Saulify does not install dependencies, run scripts, run builds, invoke package lifecycle hooks, or execute repository code.
- **SSRF resistant:** the only user-controlled input is parsed as an exact `github.com/{owner}/{repo}` pair. API URLs are rebuilt from that pair. Other hosts, ports, credentials, query strings, and nested paths are rejected.
- **Quota and resource caps:** 20 selected files, 100 KB per file, 250 MB repository size by default, 58K characters of AI context, bounded parallel GitHub fetches, and per-request timeouts.
- **Prompt-injection defense:** repository text is delimited as untrusted data, the model is told to ignore embedded instructions, credential-shaped values and private-key blocks are redacted before prompting, unknown file paths are discarded, and output is schema-validated.
- **Secret hygiene:** `.env` files and common credential files are excluded from file selection. Detected secrets are redacted in evidence. API keys are read only on the server and never sent to the browser.
- **Safe rendering:** findings and issue drafts are rendered as text, never as HTML.
- **Abuse control:** five analyses per 10 minutes per instance/IP. This is best-effort in-memory limiting; use a distributed rate limiter in a multi-instance deployment.
- **Read-only product:** no GitHub write scopes are needed. Saulify cannot create issues or comments.

## Tests

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

The tests cover URL/SSRF validation, GitHub API failure mapping, AI output parsing and evidence checks, secret redaction, file-selection boundaries, rate limiting, and server-side report rendering.

## Deployment

Deploy as a standard Next.js app (for example on Vercel). Set the server-side environment variables in the hosting dashboard. Keep `GITHUB_TOKEN` and AI keys private.

Notes for production:

- Reports live only in the browser session. Reloading before the session ends works; sharing a report URL or opening it in another browser shows a "report no longer available" state. Persistent report storage is intentionally outside the MVP.
- The in-memory limiter protects one instance. Add a shared store (Redis/Upstash) before relying on rate limits at scale.
- Analysis is bounded but can take up to roughly a minute when AI review is enabled. Configure platform function duration accordingly.
- Unauthenticated GitHub traffic permits very few analyses per hour. A server-side token is strongly recommended.

## Known limitations

- Static analysis is a curated set of pattern rules, not full data-flow analysis or the repository's own ESLint configuration. It can miss issues and can produce false positives.
- Only a ranked subset of compatible source files is inspected (maximum 20).
- AI findings are hypotheses. "Evidence matched" means the quoted snippet exists in the fetched source — not that the issue is exploitable.
- Private repositories, monorepos above the size cap, binary files, generated/vendored code, and unsupported languages are not analyzed.
- No repository code, tests, dependency graph, runtime behavior, or git history is evaluated.
- GitHub issue drafts are suggestions and must be reviewed and submitted manually.

## Non-goals for this MVP

No automatic fixes, stored analysis history, authentication, GitHub OAuth, automated issue creation, pull requests, repository modification, or code execution.

## License

MIT — see [LICENSE](LICENSE).
