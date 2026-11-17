/**
 * The two endpoints Meta talks to.
 *
 * GET  /webhook  — one-time "verification handshake". You paste this URL
 *                  into the Meta dashboard along with a verify token; Meta
 *                  immediately calls this endpoint to confirm you control it
 *                  before saving the config.
 * POST /webhook  — called every time a user sends your business number a
 *                  message (or, separately, on delivery/read receipts —
 *                  see whatsapp/parse.ts for how those are filtered out).
 *
 * Docs: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */
import type { FastifyInstance } from "fastify";
import { logMessage, STATUS_LOG_TYPE } from "db";
import { config } from "../config";
import { maskPhone, whatsAppClient } from "../whatsapp/client";
import { parseWebhook, parseStatuses } from "../whatsapp/parse";
import type { IncomingMessage, MetaStatus } from "../whatsapp/types";
import { recordStatus } from "../whatsapp/deliveryTracker";
import { handleIncomingMessage } from "../flow/engine";

interface VerifyQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

/**
 * Handles one webhook POST: mark each message read, then run it through the
 * conversation engine. Runs "in the background" relative to the route
 * handler (see registration below) so a slow or failing WhatsApp API call
 * never delays Meta's 200.
 *
 * markAsRead and handleIncomingMessage are in separate try/catch blocks on
 * purpose: markAsRead is a cosmetic read receipt, handleIncomingMessage is
 * the actual reply. A transient WhatsApp API hiccup (a timeout, a dropped
 * connection) on the read receipt shouldn't also cost the user their reply.
 */
/**
 * Meta retries a webhook delivery it thinks failed, so the same message or
 * status can arrive twice. Remembers recent keys (message id, or
 * "wamid:status") and reports repeats.
 *
 * ponytail: in-process, capped at DEDUPE_CAP keys (oldest dropped first) —
 * a restart or a second instance forgets; move to the DB if that matters.
 */
const DEDUPE_CAP = 10_000;
const seenKeys = new Set<string>();

export function isDuplicate(key: string): boolean {
  if (seenKeys.has(key)) return true;
  seenKeys.add(key);
  if (seenKeys.size > DEDUPE_CAP) seenKeys.delete(seenKeys.values().next().value!);
  return false;
}

/** In-flight background work, so tests (and graceful shutdown) can wait for it. */
const inFlight = new Set<Promise<void>>();

function track(work: Promise<void>): void {
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
}

/** Resolves once every webhook accepted so far has finished processing. */
export async function webhookIdle(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

async function processIncoming(messages: IncomingMessage[]): Promise<void> {
  for (const message of messages) {
    if (isDuplicate(message.messageId)) {
      console.log("[webhook] duplicate message ignored", message.messageId);
      continue;
    }
    try {
      await whatsAppClient.markAsRead(message.messageId);
    } catch (err) {
      console.error("[webhook] failed to mark message as read", message.messageId, err);
    }

    try {
      await handleIncomingMessage(message);
    } catch (err) {
      // Never throw out of here — this runs detached from the HTTP response.
      console.error("[webhook] failed to process message", message.messageId, err);
    }
  }
}

/**
 * Delivery receipts: feeds deliveryTracker (flow/aiChat.ts waits on these)
 * and records each sent/delivered/read/failed in message history, with
 * Meta's error code on failures. Never throws.
 */
async function processStatuses(statuses: MetaStatus[]): Promise<void> {
  for (const status of statuses) {
    if (isDuplicate(`${status.id}:${status.status}`)) continue;
    recordStatus(status.id, status.status);

    const recipient = status.recipient_id ?? status.recipient_user_id ?? "unknown";
    const errorCodes = status.errors?.map((e) => e.code) ?? [];
    if (status.status === "failed") {
      console.warn(
        `[webhook] message ${status.id} to ${maskPhone(recipient)} failed, error code(s) ${errorCodes.join(",") || "none"}`,
      );
    }
    try {
      await logMessage({
        mobileNumber: recipient,
        direction: "OUTGOING",
        type: STATUS_LOG_TYPE,
        status: status.status,
        payload: { status: status.status, errorCodes, errors: status.errors ?? [] },
        waMessageId: status.id,
      });
    } catch (err) {
      console.error("[webhook] failed to log status", status.id, err);
    }
  }
}

export function registerWebhookRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: VerifyQuery }>("/webhook", async (request, reply) => {
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } =
      request.query;

    if (mode === "subscribe" && token === config.VERIFY_TOKEN) {
      // Meta expects the raw challenge string back, not JSON.
      return reply.status(200).type("text/plain").send(challenge ?? "");
    }

    return reply.status(403).send("Verification failed");
  });

  app.post("/webhook", async (request, reply) => {
    const messages = parseWebhook(request.body);

    // Fire and forget on purpose: Meta wants a fast 200 (it will retry the
    // whole webhook delivery if we're slow), and a WhatsApp API hiccup on
    // our reply shouldn't turn into a failed/retried webhook delivery.
    track(processStatuses(parseStatuses(request.body)));
    track(processIncoming(messages));

    return reply.status(200).send("EVENT_RECEIVED");
  });
}
