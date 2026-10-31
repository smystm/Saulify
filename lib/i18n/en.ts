export const en = {
  meta: {
    title: "Saulify — evidence-first GitHub repository analysis",
    description:
      "Analyze a public GitHub repository for potential bugs and security issues. Get evidence, confidence levels, and copy-ready GitHub issue drafts without executing code.",
  },
  common: {
    brand: "Saulify",
    switchLanguage: "Switch language",
    english: "English",
    persian: "Persian",
    enShort: "EN",
    faShort: "FA",
    readOnly: "Read-only analyzer",
    features: "Features",
    repository: "Repository",
    issues: "Issues",
    newAnalysis: "New analysis",
    copy: "Copy",
    copied: "Copied",
  },
  home: {
    navHow: "How it works",
    navLimits: "Limits",
    badge: "EVIDENCE-FIRST REPOSITORY REVIEW",
    heroLine1: "Find what the last commit",
    heroLine2: "missed.",
    heroDescription:
      "Paste a public GitHub repository. Saulify reads selected source files, runs deterministic rules, and asks an optional AI reviewer to surface potential issues — with evidence you can inspect.",
    formLabel: "GitHub repository URL",
    placeholder: "https://github.com/owner/repository",
    analyze: "Analyze repo",
    analyzing: "Analyzing",
    try: "Try",
    progressNote: "Public repository data only. Larger repositories and AI review can take up to a minute.",
    steps: [
      "Validating repository",
      "Reading the source tree",
      "Running static rules",
      "Checking for AI-reviewed issues",
      "Validating and packaging report",
    ],
    trust: [
      {
        title: "No code execution",
        copy: "Source is fetched read-only. Scripts and build hooks never run.",
      },
      {
        title: "Evidence attached",
        copy: "Every finding carries a file, line, and inspectable snippet.",
      },
      {
        title: "AI is optional",
        copy: "Static rules work without keys. AI adds validated hypotheses.",
      },
    ],
    how: {
      eyebrow: "How it works",
      title: "A small pipeline with a narrow job.",
      description:
        "Saulify is intentionally not an autonomous fixer. It produces review candidates and ready-to-copy issue drafts. A human decides what happens next.",
      cards: [
        ["01", "Read", "Validated GitHub URL, repository metadata, default branch, and a capped subset of source files."],
        ["02", "Inspect", "Pattern rules and optional AI review look for risky code shapes, not runtime behavior."],
        ["03", "Report", "Findings are schema-validated, deduplicated, and paired with manual submission instructions."],
      ],
    },
    limits: {
      size: "Public repos only. Up to 250 MB source size, 20 selected files, and 5 analyses per 10 minutes per instance.",
      safety: "Saulify never creates issues, commits files, or opens pull requests.",
    },
    errors: {
      invalidUrl: "Enter a valid public GitHub repository URL, for example https://github.com/owner/repo.",
      unreadable: "The server returned an unreadable response. Please try again.",
      failed: "Analysis failed. Please try again.",
      invalidReport: "The server returned an invalid report. Please try again.",
      timeout: "The analysis took too long and was stopped. Try a smaller repository or try again.",
      quota: "The report is too large to store in this browser session. Please try again.",
      unknown: "Analysis failed. Please try again.",
    },
    apiErrors: {
      rate_limited: "Too many analyses from this address. Please wait a few minutes and try again.",
      body_too_large: "The request was too large. Try a shorter repository URL.",
      invalid_body: "The request could not be read. Please try again.",
      invalid_json: "The request was malformed. Please try again.",
      invalid_input: "Provide a public GitHub repository URL.",
      invalid_url: "Enter a valid public GitHub repository URL.",
      repo_not_found:
        "Repository not found. Private repositories are not supported — make sure it is public and the URL is correct.",
      github_rate_limit:
        "GitHub's API limit was reached. Wait a few minutes, or configure GITHUB_TOKEN on the server, then try again.",
      github_auth: "GitHub rejected the server's access token. The server needs a valid GITHUB_TOKEN.",
      github_forbidden: "GitHub refused access to this repository. It may be private or restricted.",
      repo_unavailable: "This repository is unavailable for legal reasons.",
      github_timeout: "GitHub did not respond in time. Please try again.",
      github_aborted: "The GitHub request was cancelled. Please try again.",
      github_unreachable: "Could not reach GitHub. Check the server connection and try again.",
      github_error: "GitHub returned an unexpected error. Please try again shortly.",
      github_payload: "GitHub returned incomplete repository data. Please try again.",
      response_too_large: "This repository is too large for Saulify's limits. Try a smaller repository.",
      file_too_large: "A source file exceeded the analysis size limit. Try a smaller repository.",
      repo_too_large: "This repository is above Saulify's size limit. Try a smaller repository.",
      internal_error: "Analysis failed unexpectedly. Please try again.",
    } as Record<string, string>,
  },
  report: {
    eyebrow: "Repository analysis report",
    archived: "Archived",
    forks: (count: string) => `${count} forks`,
    analysisTime: (duration: string) => `${duration} analysis`,
    files: "Files",
    evidence: "Evidence",
    reviewSummary: "Review summary",
    summary: (p: {
      total: string;
      files: string;
      critical: string;
      high: string;
      medium: string;
      low: string;
      verified: string;
      hypotheses: string;
      ai: boolean;
    }) =>
      `Found ${p.total} potential issue${p.total === "1" ? "" : "s"} across ${p.files} analyzed files (critical ${p.critical}, high ${p.high}, medium ${p.medium}, low ${p.low}) using ${
        p.ai ? "static rules plus validated AI review" : "deterministic static rules"
      }. ${p.verified} finding${p.verified === "1" ? " has" : "s have"} source-matched evidence; ${p.hypotheses} ${
        p.hypotheses === "1" ? "remains an unverified hypothesis" : "remain unverified hypotheses"
      }. Review every item before filing.`,
    evidenceLine: (verified: string, hypotheses: string) =>
      `${verified} with source-matched evidence · ${hypotheses} unverified ${
        hypotheses === "1" ? "hypothesis" : "hypotheses"
      }. Evidence matching confirms the snippet exists, not that the issue is exploitable.`,
    warnings: (count: string) => `${count} analysis note${count === "1" ? "" : "s"}`,
    technicalNote:
      "Finding text, code evidence, repository metadata, and GitHub issue drafts are shown in the analysis language. Interface controls are translated.",
    filters: {
      all: "All",
      critical: "Critical",
      high: "High",
      medium: "Medium",
      low: "Low",
      verifiedOnly: "Evidence matched only",
    },
    severities: {
      critical: "Critical",
      high: "High",
      medium: "Medium",
      low: "Low",
    },
    categories: {
      security: "Security",
      correctness: "Correctness",
      reliability: "Reliability",
      performance: "Performance",
      maintainability: "Maintainability",
      other: "Other",
    },
    confidence: {
      label: "Confidence",
      high: "High",
      medium: "Medium",
      low: "Low",
    },
    source: {
      ai: "AI reviewed",
      static: "Static rule",
    },
    evidenceStatus: {
      verified: "Evidence matched",
      unverified: "Unverified hypothesis",
    },
    finding: {
      what: "What we found",
      evidence: "Evidence",
      why: "Why it may matter",
      suggested: "Suggested direction",
      draft: "GitHub issue draft",
      copyTitle: "Copy title",
      copyDescription: "Copy description",
      openIssues: "Open issues",
      repositoryWide: "Repository-wide",
    },
    mode: {
      ai: "AI review completed",
      static: "Static analysis only",
      notUsed: "not used",
      failure: (reason: string) =>
        `AI review could not complete: ${reason} Static findings are still shown.`,
      staticNote:
        "No AI review was available. Deterministic static rules ran against the selected files, and every result remains human-reviewable.",
    },
    noIssues: "No evidence-backed issues found",
    noMatches: "No findings match these filters",
    noIssuesDescription:
      "This does not prove the repository is defect-free. Saulify inspects a limited file set with pattern rules, not every execution path.",
    noMatchesDescription: "Clear the filters to see the rest of the report.",
    clearFilters: "Clear filters",
    submit: {
      title: "Submit an issue manually",
      step1Prefix: "Open the repository's Issues page and choose",
      step1Action: "New issue",
      step1Suffix: ".",
      step2: "Pick a finding below, open its draft, and copy the title and description.",
      step3: "Paste both, check the evidence against the current branch, and add context.",
      step4: "Submit it yourself. Saulify never creates issues or comments.",
      open: "Open GitHub Issues",
    },
    coverage: {
      title: "Coverage",
      treeEntries: "Tree entries",
      filesSelected: "Files selected",
      filesAnalyzed: "Files analyzed",
      treeTruncated: "Tree truncated",
      yes: "Yes",
      no: "No",
    },
    disclaimer:
      "This report is a review aid, not a security audit. Static rules can produce false positives and the selected file set is limited. Validate every finding before filing it.",
    footerLeft: "Saulify · read-only repository analysis",
    footerRight: "No source files were modified or executed.",
    loading: "Opening report…",
    missingTitle: "This report is no longer available",
    missingDescription:
      "Saulify keeps reports only in the current browser session. Reloading after the session ends, opening the link elsewhere, or clearing site data removes it.",
    startNew: "Start a new analysis",
  },
  features: {
    eyebrow: "Four layers of review",
    title: "Four ways to see what a commit missed.",
    description:
      "Every analysis combines deterministic rules with optional AI review, then ties each finding back to the code that raised the flag.",
    replay: "Replay the tour",
    cta: {
      title: "Ready to inspect a repository?",
      description: "Paste a public GitHub URL and get an evidence-backed review in about a minute.",
      action: "Analyze a repository",
    },
    capabilities: [
      {
        title: "Security Analysis",
        short: "Catch risky code before it ships.",
        description:
          "Surface exposed secrets, injection-prone patterns, and other vulnerabilities, each anchored to the exact file and line that raised the flag.",
        points: [
          "Exposed credentials and unsafe secrets",
          "Injection and risky data flow patterns",
          "Prompt-injection resistance in AI flows",
        ],
      },
      {
        title: "Code Quality",
        short: "Keep the codebase easy to change.",
        description:
          "Find duplication, tangled complexity, and readability traps that slow reviews down and make future changes riskier than they should be.",
        points: [
          "Duplication and copy-paste drift",
          "Complex branches and oversized functions",
          "Readability and maintainability signals",
        ],
      },
      {
        title: "Architecture Analysis",
        short: "See how the pieces fit together.",
        description:
          "Map the project structure, module dependencies, and component relationships to expose layers that are too coupled or boundaries that leak.",
        points: [
          "Project structure and module layout",
          "Dependency direction and cycles",
          "Coupling and design weak spots",
        ],
      },
      {
        title: "AI-Powered Insights",
        short: "Explanations you can verify.",
        description:
          "An optional AI reviewer adds context and a suggested direction. Every result carries a confidence level and the evidence behind it.",
        points: [
          "Findings with file-level evidence",
          "Confidence levels and clear reasoning",
          "Actionable, copy-ready issue drafts",
        ],
      },
    ],
  },
  onboarding: {
    label: "Product tour",
    progress: (current: string, total: string) => `${current} / ${total}`,
    step: (current: string, total: string) => `Step ${current} of ${total}`,
    skip: "Skip",
    previous: "Previous",
    next: "Next",
    getStarted: "Get started",
  },
};

export type Dictionary = typeof en;
