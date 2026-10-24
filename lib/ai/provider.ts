export type AiProviderName = "opencode" | "openai-compatible" | "ollama";

export type AiConfig = {
  provider: AiProviderName;
  providerLabel: string;
  model: string;
  baseUrl: string;
  apiKey: string | null;
};

export type AiResolution =
  | { configured: true; config: AiConfig; note: string }
  | { configured: false; reason: string };

const AI_TIMEOUT_MS = 35_000;
const MAX_AI_RESPONSE_CHARS = 150_000;

function normalizeBaseUrl(raw: string, allowLocalHttp: boolean): string {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("AI base URL must use HTTP or HTTPS.");
  }
  const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol === "http:" && (!allowLocalHttp || !localHost)) {
    throw new Error("Use HTTPS for remote AI endpoints. Plain HTTP is only allowed for local model servers.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("AI base URLs must not contain credentials.");
  }
  return raw.replace(/\/+$/, "");
}

export function resolveAiProvider(env: NodeJS.ProcessEnv = process.env): AiResolution {
  const selected = (env.AI_PROVIDER ?? "auto").trim().toLowerCase();
  const model = env.AI_MODEL?.trim() || env.OLLAMA_MODEL?.trim() || "";

  if (selected === "off" || selected === "none" || selected === "disabled") {
    return { configured: false, reason: "AI review is disabled by configuration." };
  }

  try {
    if (selected === "opencode") {
      const apiKey = env.OPENCODE_API_KEY?.trim() || env.AI_API_KEY?.trim();
      if (!apiKey || !model) {
        return { configured: false, reason: "OpenCode AI is selected but OPENCODE_API_KEY or AI_MODEL is missing." };
      }
      return {
        configured: true,
        config: {
          provider: "opencode",
          providerLabel: "OpenCode Zen",
          model,
          baseUrl: normalizeBaseUrl(env.OPENCODE_BASE_URL?.trim() || "https://opencode.ai/zen/v1", false),
          apiKey,
        },
        note: "AI review uses OpenCode Zen.",
      };
    }

    if (selected === "openai-compatible" || selected === "openai") {
      const baseUrl = env.AI_BASE_URL?.trim();
      if (!baseUrl || !model) {
        return { configured: false, reason: "OpenAI-compatible AI is selected but AI_BASE_URL or AI_MODEL is missing." };
      }
      return {
        configured: true,
        config: {
          provider: "openai-compatible",
          providerLabel: "OpenAI-compatible endpoint",
          model,
          baseUrl: normalizeBaseUrl(baseUrl, true),
          apiKey: env.AI_API_KEY?.trim() || null,
        },
        note: "AI review uses a custom OpenAI-compatible endpoint.",
      };
    }

    if (selected === "ollama") {
      if (!model) {
        return { configured: false, reason: "Ollama is selected but OLLAMA_MODEL or AI_MODEL is missing." };
      }
      return {
        configured: true,
        config: {
          provider: "ollama",
          providerLabel: "Ollama (local)",
          model,
          baseUrl: normalizeBaseUrl(env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434", true),
          apiKey: null,
        },
        note: "AI review uses a local Ollama model.",
      };
    }

    if (selected !== "auto") {
      return { configured: false, reason: `Unknown AI_PROVIDER "${selected}".` };
    }

    const openCodeKey = env.OPENCODE_API_KEY?.trim() || env.AI_API_KEY?.trim();
    if (openCodeKey && model) {
      return {
        configured: true,
        config: {
          provider: "opencode",
          providerLabel: "OpenCode Zen",
          model,
          baseUrl: normalizeBaseUrl(env.OPENCODE_BASE_URL?.trim() || "https://opencode.ai/zen/v1", false),
          apiKey: openCodeKey,
        },
        note: "AI review uses OpenCode Zen.",
      };
    }

    if (env.AI_BASE_URL?.trim() && model) {
      return {
        configured: true,
        config: {
          provider: "openai-compatible",
          providerLabel: "OpenAI-compatible endpoint",
          model,
          baseUrl: normalizeBaseUrl(env.AI_BASE_URL.trim(), true),
          apiKey: env.AI_API_KEY?.trim() || null,
        },
        note: "AI review uses a custom OpenAI-compatible endpoint.",
      };
    }

    if (env.OLLAMA_BASE_URL?.trim() && model) {
      return {
        configured: true,
        config: {
          provider: "ollama",
          providerLabel: "Ollama (local)",
          model,
          baseUrl: normalizeBaseUrl(env.OLLAMA_BASE_URL.trim(), true),
          apiKey: null,
        },
        note: "AI review uses a local Ollama model.",
      };
    }

    return {
      configured: false,
      reason:
        "No AI provider is configured. Static analysis still runs; set OPENCODE_API_KEY + AI_MODEL, AI_BASE_URL + AI_MODEL, or OLLAMA_BASE_URL + OLLAMA_MODEL to add AI review.",
    };
  } catch (error) {
    return {
      configured: false,
      reason: error instanceof Error ? error.message : "AI provider configuration is invalid.",
    };
  }
}

function extractOpenAiContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
    return joined || null;
  }
  return null;
}

async function readResponseText(response: Response): Promise<string> {
  const text = await response.text();
  if (text.length > MAX_AI_RESPONSE_CHARS) {
    throw new Error("AI provider response exceeded the size limit.");
  }
  return text;
}

export async function requestAiCompletion(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const isOllama = config.provider === "ollama";
  const endpoint = isOllama ? `${config.baseUrl}/api/chat` : `${config.baseUrl}/chat/completions`;
  const body = isOllama
    ? {
        model: config.model,
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_predict: 3000 },
        messages,
      }
    : {
        model: config.model,
        temperature: 0.1,
        max_tokens: 3200,
        messages,
      };

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("AI provider timed out.");
    }
    throw new Error("Could not reach the AI provider.");
  }

  if (!response.ok) {
    throw new Error(`AI provider returned HTTP ${response.status}.`);
  }

  const text = await readResponseText(response);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("AI provider returned a non-JSON response.");
  }

  if (isOllama) {
    const content = (payload as { message?: { content?: unknown } } | null)?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI provider returned an empty response.");
    }
    return content;
  }

  const content = extractOpenAiContent(payload);
  if (!content || !content.trim()) {
    throw new Error("AI provider returned an empty response.");
  }
  return content;
}
