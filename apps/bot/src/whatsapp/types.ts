/**
 * Types for the WhatsApp Cloud API webhook payload.
 *
 * When a user messages your business number, Meta POSTs a JSON body to your
 * webhook URL shaped like the types below. It's deeply nested because one
 * webhook call can (in theory) batch multiple WhatsApp Business Accounts,
 * each with multiple "changes" (message events, status updates, etc).
 *
 * In practice, for a single incoming message, the shape is:
 *   entry[0].changes[0].value.messages[0]
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */

/** A single incoming message, as Meta sends it. */
export interface MetaMessage {
  from: string; // sender's WhatsApp number (no "+", e.g. "919812345678")
  id: string; // Meta's unique ID for this message, needed to mark it read
  timestamp: string; // unix seconds, as a string
  type: string; // "text" | "interactive" | "image" | "button" | ... (open-ended, Meta adds types over time)
  text?: {
    body: string;
  };
  // Present when type === "audio" — a voice note or shared audio file. The
  // webhook never carries the bytes themselves, only this id: fetch a
  // short-lived download URL for it via WhatsAppClient.getMediaInfo.
  audio?: {
    id: string;
    mime_type: string; // e.g. "audio/ogg; codecs=opus" for an in-app voice note
    // true for a voice note recorded in-app (push-to-talk); absent/false for
    // a shared audio file forwarded from elsewhere.
    voice?: boolean;
    sha256?: string;
  };
  // Present when the user tapped a button or list row we sent earlier.
  interactive?: {
    type: string; // "button_reply" | "list_reply"
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
}

/** A delivery/read receipt for a message WE sent. Not a user message. */
export interface MetaStatus {
  id: string;
  status: string; // "sent" | "delivered" | "read" | "failed"
  timestamp: string;
  recipient_id: string;
}

export interface MetaWebhookValue {
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Array<{
    profile: { name: string };
    wa_id: string;
  }>;
  // Present on an incoming-message event.
  messages?: MetaMessage[];
  // Present on a delivery/read-receipt event instead of `messages`.
  statuses?: MetaStatus[];
}

export interface MetaWebhookChange {
  value: MetaWebhookValue;
  field: string; // "messages"
}

export interface MetaWebhookEntry {
  id: string;
  changes: MetaWebhookChange[];
}

/** The full POST body Meta sends to your webhook URL. */
export interface MetaWebhookPayload {
  object: string; // "whatsapp_business_account"
  entry: MetaWebhookEntry[];
}

/**
 * Our own simplified shape, after `parseWebhook()` has dug through the
 * nesting above. This is what the rest of the app (routes, conversation
 * logic) should work with — nobody outside whatsapp/ should touch
 * MetaWebhookPayload directly.
 */
export interface IncomingMessage {
  from: string;
  messageId: string;
  type: "text" | "button_reply" | "list_reply" | "audio" | "other";
  /** Set when type === "text". */
  text?: string;
  /** Set when type is a button/list reply: the id you assigned that button/row. */
  replyId?: string;
  /** Set when type is a button/list reply: the title text that was shown. */
  replyTitle?: string;
  /** Set when type === "audio": Meta's media id — pass to WhatsAppClient.getMediaInfo to get a download URL. */
  mediaId?: string;
  /** Set when type === "audio": Meta's reported MIME type, e.g. "audio/ogg; codecs=opus". */
  mimeType?: string;
  /** Set when type === "audio": true for an in-app voice note, false/absent for a shared audio file. */
  isVoiceNote?: boolean;
  /** WhatsApp profile display name, from the webhook's `contacts[]` block, when present. */
  profileName?: string;
  timestamp: string;
}
