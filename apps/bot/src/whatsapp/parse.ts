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
  MetaStatus,
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

    const flowReply = message.interactive?.nfm_reply;
    if (typeof flowReply?.response_json === "string") {
      try {
        const parsed: unknown = JSON.parse(flowReply.response_json);
        if (typeof parsed === "object" && parsed !== null) {
          return { ...base, type: "flow_reply", flowResponse: parsed as Record<string, unknown> };
        }
      } catch {
        // malformed response_json -> falls through to "other"
      }
    }
  }

  if (message.type === "order" && message.order?.catalog_id && Array.isArray(message.order.product_items)) {
    return {
      ...base,
      type: "order",
      order: {
        catalogId: message.order.catalog_id,
        items: message.order.product_items.map((item) => ({
          retailerId: String(item?.product_retailer_id ?? ""),
          quantity: Number(item?.quantity),
          itemPrice: Number(item?.item_price),
          currency: String(item?.currency ?? ""),
        })),
      },
    };
  }

  if (message.type === "button" && message.button?.payload) {
    // Answers an open question from the docs: do carousel quick-reply taps
    // arrive as this template-style shape or as interactive.button_reply?
    console.log(`[webhook] quick-reply tap arrived as type=button (payload ${message.button.payload})`);
    return {
      ...base,
      type: "button_reply",
      replyId: message.button.payload,
      replyTitle: message.button.text,
    };
  }

  if (message.type === "audio" && message.audio?.id) {
    return {
      ...base,
      type: "audio",
      mediaId: message.audio.id,
      mimeType: message.audio.mime_type,
      isVoiceNote: message.audio.voice === true,
    };
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
      // this same webhook field — ignored here, see parseStatuses() below
      // for those; this function only looks at `messages` (things a user
      // sent to us).
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

/**
 * The `statuses` counterpart to parseWebhook() above — delivery/read/failed
 * receipts for messages WE sent, keyed by their wamid. See
 * whatsapp/deliveryTracker.ts for what consumes these.
 *
 * @param body The same raw webhook body passed to parseWebhook().
 */
export function parseStatuses(body: unknown): MetaStatus[] {
  const payload = body as Partial<MetaWebhookPayload> | null | undefined;
  const entries = payload?.entry;
  if (!Array.isArray(entries)) {
    return [];
  }

  const results: MetaStatus[] = [];

  for (const entry of entries) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const statuses = change?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const status of statuses) {
        if (status?.id && status.status) results.push(status);
      }
    }
  }

  return results;
}
