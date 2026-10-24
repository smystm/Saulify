import { z } from "zod";
import { analyzeRepository } from "@/lib/analyzer";
import { AnalysisError } from "@/lib/errors";
import { checkRateLimit, getClientIdentifier } from "@/lib/security/rate-limit";

export const maxDuration = 60;

const MAX_BODY_CHARS = 4_096;
const bodySchema = z.object({
  url: z.string().trim().min(1).max(500),
});

function jsonError(message: string, status: number, code: string, headers: HeadersInit = {}) {
  return Response.json(
    { error: { message, code } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...headers,
      },
    },
  );
}

export async function POST(request: Request) {
  const client = getClientIdentifier(request);
  const limit = checkRateLimit(`analyze:${client}`, { limit: 5, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return jsonError(
      `Too many analyses from this address. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute${limit.retryAfterSeconds > 60 ? "s" : ""}.`,
      429,
      "rate_limited",
      {
        "Retry-After": String(limit.retryAfterSeconds),
        "X-RateLimit-Limit": "5",
        "X-RateLimit-Remaining": "0",
      },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_CHARS) {
    return jsonError("Request body is too large.", 413, "body_too_large");
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError("Could not read the request body.", 400, "invalid_body");
  }

  if (rawBody.length > MAX_BODY_CHARS) {
    return jsonError("Request body is too large.", 413, "body_too_large");
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError("Request body must be valid JSON.", 400, "invalid_json");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Provide a GitHub repository URL.", 400, "invalid_input");
  }

  try {
    const report = await analyzeRepository(parsed.data.url);
    return Response.json(report, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Limit": "5",
        "X-RateLimit-Remaining": String(limit.remaining),
      },
    });
  } catch (error) {
    if (error instanceof AnalysisError) {
      return jsonError(error.message, error.status, error.code);
    }
    console.error("[saulify] analysis failed", error);
    return jsonError("Analysis failed unexpectedly. Please try again.", 500, "internal_error");
  }
}
