import type { Category, Confidence, Finding, Severity } from "@/lib/reports/schema";
import type { FetchedFile } from "@/lib/github/client";

type RuleMatch = {
  title: string;
  severity: Severity;
  confidence: Confidence;
  category: Category;
  explanation: string;
  whyProblematic: string;
  suggestedFix: string;
  evidence?: string;
  endLine?: number;
};

type StaticRule = {
  id: string;
  applies: (path: string) => boolean;
  match: (line: string, index: number, lines: string[]) => RuleMatch | null;
};

const JS_LIKE = /\.(js|jsx|mjs|cjs|ts|tsx)$/i;
const PYTHON = /\.py$/i;

const SECRET_ASSIGNMENT =
  /((?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?key)\s*[:=]\s*)(["'`])([^"'`\n]{8,})\2/i;

const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/;

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("--")
  );
}

function isPlaceholder(value: string): boolean {
  return /(process\.env|os\.environ|your[_-]|example|placeholder|changeme|dummy|sample|xxxx|redacted|\$\{|\*\*\*|<|\btest\b)/i.test(
    value,
  );
}

function redact(line: string): string {
  return line.replace(SECRET_ASSIGNMENT, (_match, prefix: string, quote: string) => {
    return `${prefix}${quote}[REDACTED]${quote}`;
  });
}

/** Removes credential-shaped values before content is put in a prompt. */
export function redactSensitiveText(code: string): string {
  return code
    .replace(
      /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY BLOCK]",
    )
    .replace(SECRET_ASSIGNMENT, (_match, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`);
}

function dynamicCommand(line: string): boolean {
  const opening = line.indexOf("(");
  if (opening < 0) return false;
  const argument = line.slice(opening + 1).trim();
  return (
    argument.startsWith("`") && argument.includes("${")
      ? true
      : argument.startsWith("+") ||
        /^[A-Za-z_$][\w$]*\s*[,)]/.test(argument) ||
        /\+\s*[A-Za-z_$][\w$]*/.test(argument)
  );
}

function shortSnippet(lines: string[], index: number, endIndex = index): string {
  return lines
    .slice(index, Math.min(lines.length, endIndex + 1))
    .map((line) => redact(line).trim())
    .join("\n")
    .slice(0, 1800);
}

const RULES: StaticRule[] = [
  {
    id: "private-key",
    applies: () => true,
    match: (line) =>
      PRIVATE_KEY.test(line)
        ? {
            title: "Private key material appears to be committed",
            severity: "critical",
            confidence: "high",
            category: "security",
            explanation:
              "A private key marker was found inside a tracked source file. Private keys should never be stored in a repository, even if the key is intended for development.",
            whyProblematic:
              "Anyone with repository access may be able to recover the key and impersonate the associated service, decrypt traffic, or gain privileged access. Git history retains the value even after a later deletion.",
            suggestedFix:
              "Revoke and rotate the exposed key immediately. Remove it from the repository and history, and load the replacement from a secret manager or environment variable.",
            evidence: "[REDACTED PRIVATE KEY MATERIAL]",
          }
        : null,
  },
  {
    id: "hardcoded-secret",
    applies: () => true,
    match: (line) => {
      if (isComment(line)) return null;
      const match = SECRET_ASSIGNMENT.exec(line);
      if (!match || isPlaceholder(match[3])) return null;
      return {
        title: "Potential hardcoded credential",
        severity: "high",
        confidence: "medium",
        category: "security",
        explanation:
          "A secret-like value is assigned directly in source code. Automated detection cannot tell whether this is a real credential, so the value has been redacted.",
        whyProblematic:
          "Committed credentials can leak through repository access, forks, logs, or build artifacts. Rotating a leaked credential is the only reliable remediation once it is in history.",
        suggestedFix:
          "Confirm whether the value is live. If it is, revoke and rotate it. Load secrets from server-side environment variables or a secret manager, and add secret scanning to CI.",
      };
    },
  },
  {
    id: "dangerously-set-inner-html",
    applies: (path) => JS_LIKE.test(path),
    match: (line) =>
      /dangerouslySetInnerHTML\s*=/.test(line)
        ? {
            title: "Raw HTML is injected into the React tree",
            severity: "high",
            confidence: "medium",
            category: "security",
            explanation:
              "dangerouslySetInnerHTML bypasses React's escaping. If any part of the value is influenced by users, URL parameters, or repository content, it can introduce cross-site scripting.",
            whyProblematic:
              "Injected script can read session data, perform actions as the user, or alter the page. The impact depends on what the HTML can contain and where it is rendered.",
            suggestedFix:
              "Prefer rendering structured text. If HTML is essential, sanitize it with a maintained allow-list sanitizer and document why raw HTML is required.",
          }
        : null,
  },
  {
    id: "inner-html",
    applies: (path) => JS_LIKE.test(path),
    match: (line) =>
      /\.(innerHTML|outerHTML|insertAdjacentHTML)\s*(?:=|\()/.test(line)
        ? {
            title: "HTML is assigned from a string",
            severity: "medium",
            confidence: "medium",
            category: "security",
            explanation:
              "Assigning HTML strings directly can turn untrusted input into executable markup. This is a risk pattern, not proof that a specific value is attacker-controlled.",
            whyProblematic:
              "Cross-site scripting can occur when the assigned value incorporates user input, server data, or third-party content without sanitization.",
            suggestedFix:
              "Use DOM APIs such as textContent, or sanitize the HTML with a well-maintained allow-list sanitizer before insertion.",
          }
        : null,
  },
  {
    id: "eval",
    applies: (path) => JS_LIKE.test(path),
    match: (line) =>
      /\beval\s*\(/.test(line) && !isComment(line)
        ? {
            title: "Dynamic code execution with eval",
            severity: "high",
            confidence: "high",
            category: "security",
            explanation:
              "eval executes a string as JavaScript in the current scope. Static analysis confirms the call site; it does not confirm that an attacker can influence its input.",
            whyProblematic:
              "If any part of the evaluated string is attacker-influenced, this becomes arbitrary code execution. It also defeats bundling, static analysis, and Content Security Policy protections.",
            suggestedFix:
              "Replace eval with explicit parsing or a dispatch map. If a narrow dynamic expression is required, use a restricted parser instead of the JavaScript evaluator.",
          }
        : null,
  },
  {
    id: "new-function",
    applies: (path) => JS_LIKE.test(path),
    match: (line) =>
      /\bnew\s+Function\s*\(/.test(line) || /\bFunction\s*\(\s*["'`]/.test(line)
        ? {
            title: "Code is constructed from a string via Function",
            severity: "high",
            confidence: "medium",
            category: "security",
            explanation:
              "The Function constructor compiles a string into executable code. This pattern is risky whenever the string is not a fixed literal.",
            whyProblematic:
              "User-controlled input can become arbitrary code. Even fixed strings can be blocked unexpectedly by CSP and are difficult to audit.",
            suggestedFix:
              "Use a fixed lookup table or explicit control flow. Avoid compiling strings into executable code.",
          }
        : null,
  },
  {
    id: "dynamic-child-process",
    applies: (path) => JS_LIKE.test(path),
    match: (line) => {
      if (!/\b(?:exec|execSync|spawn|spawnSync)\s*\(/.test(line) || isComment(line)) return null;
      if (!dynamicCommand(line)) return null;
      return {
        title: "Child process is invoked with a dynamic command",
        severity: "high",
        confidence: "medium",
        category: "security",
        explanation:
          "A process-spawning API receives a value built from a variable or template expression. This is the shape of a command-injection sink.",
        whyProblematic:
          "If the command or arguments can be influenced by request data, filenames, or repository contents, an attacker may execute additional commands with the server's privileges.",
        suggestedFix:
          "Avoid shell execution. Use execFile/spawn with a fixed executable and an argument array, validate allow-listed inputs, and never enable a shell for untrusted values.",
        endLine: undefined,
      };
    },
  },
  {
    id: "empty-catch",
    applies: (path) => JS_LIKE.test(path),
    match: (line, index, lines) => {
      const catchMatch = /\bcatch\s*(?:\([^)]*\))?\s*\{/.exec(line);
      if (!catchMatch) return null;
      const braceIndex = line.indexOf("{", catchMatch.index);
      if (braceIndex < 0) return null;
      const afterBrace = line.slice(braceIndex + 1).trim();
      if (afterBrace && afterBrace !== "}") return null;
      if (afterBrace === "}") {
        return {
          title: "Errors are silently swallowed",
          severity: "medium",
          confidence: "high",
          category: "reliability",
          explanation:
            "An empty catch block discards the failure. The caller cannot distinguish success from a failed operation.",
          whyProblematic:
            "Silent failures leave systems in inconsistent states and make production incidents difficult to diagnose. Later code may run with missing or stale data.",
          suggestedFix:
            "Handle the error explicitly. At minimum, log structured context (without secrets) and return a meaningful failure or recoverable default.",
        };
      }
      const nextLine = lines[index + 1]?.trim();
      if (nextLine === "}") {
        return {
          title: "Errors are silently swallowed",
          severity: "medium",
          confidence: "high",
          category: "reliability",
          explanation:
            "An empty catch block discards the failure. The caller cannot distinguish success from a failed operation.",
          whyProblematic:
            "Silent failures leave systems in inconsistent states and make production incidents difficult to diagnose.",
          suggestedFix: "Handle the error explicitly or rethrow it with useful context.",
          endLine: index + 2,
        };
      }
      return null;
    },
  },
  {
    id: "sql-concatenation",
    applies: (path) => JS_LIKE.test(path) || PYTHON.test(path),
    match: (line) => {
      if (isComment(line)) return null;
      const hasSql = /\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set|where)\b/i.test(line);
      const isDynamic = /\+\s*[A-Za-z_$]/.test(line) || /\$\{[^}]+\}/.test(line);
      if (!hasSql || !isDynamic) return null;
      return {
        title: "SQL query is assembled dynamically",
        severity: "medium",
        confidence: "medium",
        category: "security",
        explanation:
          "A SQL statement appears to be built with concatenation or string interpolation. Whether this is exploitable depends on the source of the interpolated value.",
        whyProblematic:
          "If request data reaches this string, attackers may be able to alter query structure (SQL injection). Dynamic SQL also makes queries harder to cache and audit.",
        suggestedFix:
          "Use parameterized queries or an ORM's bound parameters. Never interpolate untrusted values into SQL text.",
      };
    },
  },
  {
    id: "disabled-tls-verification",
    applies: (path) => JS_LIKE.test(path),
    match: (line) =>
      /rejectUnauthorized\s*:\s*false/.test(line) && !isComment(line)
        ? {
            title: "TLS certificate verification is disabled",
            severity: "high",
            confidence: "high",
            category: "security",
            explanation:
              "The connection is configured to accept certificates without validating the trust chain.",
            whyProblematic:
              "Disabling verification makes the connection vulnerable to man-in-the-middle attacks, allowing credentials or data to be intercepted.",
            suggestedFix:
              "Remove rejectUnauthorized: false. If a private CA is required, configure the correct CA bundle instead of disabling verification.",
          }
        : null,
  },
  {
    id: "public-secret-env",
    applies: (path) => JS_LIKE.test(path),
    match: (line) =>
      /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY)/i.test(line)
        ? {
            title: "Secret-looking value uses a public environment prefix",
            severity: "high",
            confidence: "medium",
            category: "security",
            explanation:
              "NEXT_PUBLIC_ variables are embedded into client-side JavaScript. A value with a secret-like name under this prefix can therefore be exposed to every visitor.",
            whyProblematic:
              "Public build-time values cannot be revoked from already-downloaded bundles. If this is a live credential, it should be considered compromised.",
            suggestedFix:
              "Move privileged values to server-only environment variables. Expose only non-sensitive configuration with NEXT_PUBLIC_, and rotate any value that was shipped.",
          }
        : null,
  },
  {
    id: "insecure-http",
    applies: (path) => JS_LIKE.test(path),
    match: (line) => {
      if (isComment(line)) return null;
      if (!/(?:fetch|axios\.(?:get|post|put|patch|delete)|request)\s*\(\s*["'`]http:\/\//i.test(line)) {
        return null;
      }
      return {
        title: "Network request uses plaintext HTTP",
        severity: "medium",
        confidence: "high",
        category: "security",
        explanation: "A request is made over HTTP rather than HTTPS.",
        whyProblematic:
          "Traffic can be read or modified in transit. Credentials, tokens, and personal data sent over HTTP should be treated as exposed.",
        suggestedFix: "Use HTTPS and verify the remote host supports a valid certificate.",
      };
    },
  },
  {
    id: "target-blank",
    applies: (path) => JS_LIKE.test(path),
    match: (line, index, lines) => {
      if (!/target\s*=\s*["']_blank["']/.test(line)) return null;
      const nearby = lines.slice(Math.max(0, index - 1), index + 3).join(" ");
      if (/rel\s*=\s*["'][^"']*noopener/i.test(nearby)) return null;
      return {
        title: "New-tab link does not set rel=noopener",
        severity: "low",
        confidence: "medium",
        category: "security",
        explanation:
          "The link opens a new tab without an explicit noopener relationship. Modern browsers often provide this implicitly, but explicit protection is more portable.",
        whyProblematic:
          "On older or less consistent browsers, the opened page can access window.opener and redirect the original tab (reverse tabnabbing).",
        suggestedFix: 'Add rel="noopener noreferrer" to links with target="_blank".',
      };
    },
  },
  {
    id: "python-shell",
    applies: (path) => PYTHON.test(path),
    match: (line) =>
      /subprocess\.(?:run|call|Popen|check_output)\s*\([\s\S]*shell\s*=\s*True/.test(line)
        ? {
            title: "Subprocess is launched through a shell",
            severity: "high",
            confidence: "medium",
            category: "security",
            explanation:
              "shell=True asks the operating system to parse a command string. If request data or filenames reach that string, shell metacharacters become executable syntax.",
            whyProblematic:
              "Command injection can lead to arbitrary command execution with the privileges of the application process.",
            suggestedFix:
              "Pass an argument list with shell=False, use a fixed executable, and validate any values that must be supplied by users.",
          }
        : null,
  },
  {
    id: "python-eval",
    applies: (path) => PYTHON.test(path),
    match: (line) =>
      /\b(?:eval|exec)\s*\(/.test(line) && !isComment(line)
        ? {
            title: "Dynamic Python code execution",
            severity: "high",
            confidence: "medium",
            category: "security",
            explanation: "eval or exec is used on a value that may be influenced at runtime.",
            whyProblematic:
              "If any part of the input is attacker-controlled, this becomes arbitrary Python code execution.",
            suggestedFix: "Use explicit parsing, a dispatch table, or a constrained data format instead.",
          }
        : null,
  },
  {
    id: "python-verify-false",
    applies: (path) => PYTHON.test(path),
    match: (line) =>
      /verify\s*=\s*False/.test(line) && !isComment(line)
        ? {
            title: "TLS verification is disabled in a Python request",
            severity: "high",
            confidence: "high",
            category: "security",
            explanation: "The request library is instructed not to verify TLS certificates.",
            whyProblematic:
              "An attacker able to intercept traffic could impersonate the remote service and read or alter exchanged data.",
            suggestedFix:
              "Remove verify=False. If a private certificate authority is needed, provide its CA bundle explicitly.",
          }
        : null,
  },
  {
    id: "python-bare-except",
    applies: (path) => PYTHON.test(path),
    match: (line) =>
      /^\s*except\s*:\s*$/.test(line)
        ? {
            title: "Bare except hides unexpected failures",
            severity: "medium",
            confidence: "high",
            category: "reliability",
            explanation:
              "A bare except catches every exception, including interrupts and programming errors that should normally propagate.",
            whyProblematic:
              "The application may continue in an invalid state because critical failures are treated the same as routine errors.",
            suggestedFix:
              "Catch the narrowest expected exception type and handle, log, or re-raise it deliberately.",
          }
        : null,
  },
  {
    id: "python-pickle",
    applies: (path) => PYTHON.test(path),
    match: (line) =>
      /\bpickle\.loads?\s*\(/.test(line) && !isComment(line)
        ? {
            title: "Pickle deserialization of potentially untrusted data",
            severity: "medium",
            confidence: "medium",
            category: "security",
            explanation:
              "Pickle can execute code while unpickling. This is dangerous if the serialized bytes originate outside the application's trust boundary.",
            whyProblematic:
              "Loading a crafted pickle payload can result in arbitrary code execution before validation is possible.",
            suggestedFix:
              "Prefer JSON or another data-only format. If pickle is unavoidable, verify data authenticity with HMAC and keep the key server-side.",
          }
        : null,
  },
  {
    id: "python-debug",
    applies: (path) => PYTHON.test(path),
    match: (line) =>
      /^\s*DEBUG\s*=\s*True\s*$/.test(line)
        ? {
            title: "Debug mode is enabled",
            severity: "medium",
            confidence: "medium",
            category: "security",
            explanation:
              "A debug flag is set to true in tracked settings. Debug mode can expose stack traces and configuration details.",
            whyProblematic:
              "In production, verbose error pages may reveal secrets, internal paths, or framework internals useful to an attacker.",
            suggestedFix:
              "Drive DEBUG from an environment variable and ensure it defaults to false outside local development.",
          }
        : null,
  },
];

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function hash(input: string): string {
  let value = 2166136261;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

export function buildIssue(finding: {
  title: string;
  severity: Severity;
  confidence: Confidence;
  category: Category;
  explanation: string;
  whyProblematic: string;
  suggestedFix: string;
  evidence: string;
  file: string | null;
  startLine: number | null;
  endLine: number | null;
  source: "static" | "ai";
  evidenceStatus: "verified" | "unverified";
}): { title: string; body: string } {
  const location = finding.file
    ? `${finding.file}${finding.startLine ? `:${finding.startLine}${finding.endLine && finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}` : ""}`
    : "Repository-wide";
  const issueTitle = `[${finding.severity}] ${finding.title}${finding.file ? ` in ${finding.file}` : ""}`.slice(0, 220);
  const body = [
    "## Summary",
    finding.explanation,
    "",
    "## Location",
    `\`${location}\``,
    "",
    "## Evidence",
    finding.evidence ? `~~~\n${finding.evidence.replace(/~~~/g, "~ ~ ~")}\n~~~` : "_No inline evidence was captured._",
    "",
    "## Why this may be a problem",
    finding.whyProblematic,
    "",
    "## Suggested direction",
    finding.suggestedFix,
    "",
    "## Review notes",
    `- Severity: **${finding.severity}**`,
    `- Confidence: **${finding.confidence}**`,
    `- Evidence: **${finding.evidenceStatus === "verified" ? "matched in source" : "unverified hypothesis"}**`,
    `- Source: ${finding.source === "static" ? "static rule" : "AI review"}`,
    "",
    "> Potential issue identified by Saulify. This is not a confirmed exploit. A maintainer should validate the finding before treating it as a security vulnerability.",
  ].join("\n");

  return {
    title: issueTitle,
    body: body.slice(0, 10_000),
  };
}

export function analyzeStaticFiles(files: FetchedFile[], maxFindings = 26): Finding[] {
  const findings: Finding[] = [];
  const perRule = new Map<string, number>();

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim() || line.length > 1200) continue;

      for (const rule of RULES) {
        if (!rule.applies(file.path)) continue;
        const key = `${rule.id}:${file.path}`;
        if ((perRule.get(key) ?? 0) >= 2) continue;

        let match: RuleMatch | null = null;
        try {
          match = rule.match(line, index, lines);
        } catch {
          match = null;
        }
        if (!match) continue;

        perRule.set(key, (perRule.get(key) ?? 0) + 1);
        const evidence = match.evidence ?? shortSnippet(lines, index, match.endLine ? index + 1 : index);
        const startLine = index + 1;
        const endLine = match.endLine ?? startLine;
        const base = {
          title: match.title,
          severity: match.severity,
          confidence: match.confidence,
          category: match.category,
          explanation: match.explanation,
          whyProblematic: match.whyProblematic,
          suggestedFix: match.suggestedFix,
          evidence,
          file: file.path,
          startLine,
          endLine,
          source: "static" as const,
          evidenceStatus: "verified" as const,
        };

        findings.push({
          id: `static-${hash(`${rule.id}:${file.path}:${startLine}`)}`,
          ...base,
          issue: buildIssue(base),
        });

        if (findings.length >= maxFindings) {
          return findings.sort(
            (a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] || a.file!.localeCompare(b.file!),
          );
        }
      }
    }
  }

  return findings.sort(
    (a, b) =>
      SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] ||
      (a.file ?? "").localeCompare(b.file ?? "") ||
      (a.startLine ?? 0) - (b.startLine ?? 0),
  );
}
