/**
 * Turns a raw Meta webhook POST body into a flat list of IncomingMessage.
 *
 * Kept defensive throughout: Meta's payload is deeply nested and we don't
 * control it, so a malformed or unexpected shape should be skipped rather
 * than throwing and taking down the webhook handler.
 */
import type {
  IncomingMessage,
  MetaMessage,
  MetaWebhookPayload,
} from "./types";

function normalizeMessage(
  message: MetaMessage,
  profileName?: string,
): IncomingMessage | null {
  const base = {
    from: message.from,
    messageId: message.id,
    timestamp: message.timestamp,
    profileName,
  };

  if (!base.from || !base.messageId) {
    return null;
  }

  if (message.type === "text" && message.text?.body) {
    return { ...base, type: "text", text: message.text.body };
  }

  if (message.type === "interactive") {
    const buttonReply = message.interactive?.button_reply;
    if (buttonReply?.id && buttonReply.title) {
      return {
        ...base,
        type: "button_reply",
        replyId: buttonReply.id,
        replyTitle: buttonReply.title,
      };
    }

    const listReply = message.interactive?.list_reply;
    if (listReply?.id && listReply.title) {
      return {
        ...base,
        type: "list_reply",
        replyId: listReply.id,
        replyTitle: listReply.title,
      };
    }
  }

  // Anything else (image, document, location, unsupported, ...) — we still
  // surface it as "other" so callers know a message arrived, just with no
  // content we currently understand.
  return { ...base, type: "other" };
}

/**
 * @param body The raw, untyped JSON body Fastify parsed from the POST request.
 */
export function parseWebhook(body: unknown): IncomingMessage[] {
  const payload = body as Partial<MetaWebhookPayload> | null | undefined;
  const entries = payload?.entry;
  if (!Array.isArray(entries)) {
    return [];
  }

  const results: IncomingMessage[] = [];

  for (const entry of entries) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      // `statuses` (delivery/read receipts for messages WE sent) show up on
      // this same webhook field — we deliberately ignore those here and
      // only look at `messages` (things a user sent to us).
      const messages = change?.value?.messages;
      if (!Array.isArray(messages)) continue;

      // `contacts[]` carries the sender's WhatsApp profile name, keyed by
      // wa_id — matched up here so ENTRY (flow/definition.ts) can register
      // a brand-new number under their display name without a lookup of
      // its own.
      const contacts = change?.value?.contacts;

      for (const message of messages) {
        if (!message) continue;
        const profileName = contacts?.find((c) => c.wa_id === message.from)
          ?.profile?.name;
        const normalized = normalizeMessage(message, profileName);
        if (normalized) results.push(normalized);
      }
    }
  }

  return results;
}
