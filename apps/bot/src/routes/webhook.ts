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
import { config } from "../config";
import { whatsAppClient } from "../whatsapp/client";
import { parseWebhook } from "../whatsapp/parse";
import type { IncomingMessage } from "../whatsapp/types";
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
async function processIncoming(messages: IncomingMessage[]): Promise<void> {
  for (const message of messages) {
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
    void processIncoming(messages);

    return reply.status(200).send("EVENT_RECEIVED");
  });
}
