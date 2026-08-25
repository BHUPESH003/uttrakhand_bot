/**
 * HTTP client for the external "Chat with us" AI service. Mirrors
 * whatsapp/client.ts's role: knows HOW to call the AI API, has zero
 * opinions about WHAT the bot does with the response — that's
 * flow/aiChat.ts.
 */
import { config } from "../config";
import type { AiConverseRequest, AiConverseResponse } from "./types";

/** Any failure to get a usable response back — timeout, network error, non-2xx, or a malformed body. Callers show one graceful fallback for all of these, never a raw error (see the contract's reliability section). */
export class AiServiceError extends Error {}

// Contract-decided demo-phase value (ai-handoff-contract.html#reliability)
// — no p95 latency requirement set yet, and no auto-retry on our side.
const TIMEOUT_MS = 25_000;

function isConverseResponse(body: unknown): body is AiConverseResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as AiConverseResponse).messages) &&
    typeof (body as AiConverseResponse).control === "object" &&
    (body as AiConverseResponse).control !== null
  );
}

export async function converseWithAi(request: AiConverseRequest): Promise<AiConverseResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${config.AI_SERVICE_URL}/v1/converse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.AI_SERVICE_TOKEN}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    throw new AiServiceError(
      err instanceof Error && err.name === "AbortError"
        ? `AI service call exceeded ${TIMEOUT_MS}ms budget`
        : `AI service request failed: ${String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new AiServiceError(`AI service returned ${response.status}`);
  }
  if (!isConverseResponse(body)) {
    throw new AiServiceError("AI service returned a malformed response body");
  }
  return body;
}
