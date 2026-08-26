/**
 * A thin, typed wrapper around the WhatsApp Cloud API (part of Meta's Graph
 * API). This file knows HOW to talk to WhatsApp — it has zero opinions about
 * WHAT your bot says. Conversation/routing logic belongs in routes/, not here.
 *
 * Every method builds a JSON body in the exact shape Graph API expects and
 * POSTs it to:
 *   https://graph.facebook.com/{GRAPH_API_VERSION}/{PHONE_NUMBER_ID}/messages
 * authenticated with `Authorization: Bearer <WHATSAPP_TOKEN>`.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */
import { config } from "../config";

/** Meta's error responses always look like this. */
interface MetaErrorResponse {
  error: {
    message: string;
    type?: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

function isMetaErrorResponse(body: unknown): body is MetaErrorResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "object"
  );
}

/** Response shape for `GET /{media-id}` — see WhatsAppClient.getMediaInfo. */
interface MediaInfoResponse {
  url: string;
  mime_type: string;
  file_size: number;
  id: string;
}

function isMediaInfoResponse(body: unknown): body is MediaInfoResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as MediaInfoResponse).url === "string" &&
    typeof (body as MediaInfoResponse).mime_type === "string" &&
    typeof (body as MediaInfoResponse).file_size === "number"
  );
}

/**
 * Meta enforces these character limits server-side and rejects the whole
 * message with a 400 if any is exceeded (error 131009) — checking here
 * turns that into an immediate, clear error pointing at the offending
 * string, instead of a webhook-side crash discovered only by trying it in
 * a language where the count is less obvious (Devanagari conjuncts run
 * several codepoints per visible character, so copy that looks short can
 * still overflow).
 */
function assertMaxLength(value: string, max: number, label: string): void {
  if (value.length > max) {
    throw new Error(
      `${label} exceeds WhatsApp's ${max}-character limit (got ${value.length}): "${value}"`,
    );
  }
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

/** One button for sendReplyButtons. WhatsApp allows at most 3 per message. */
export interface ReplyButton {
  /** Your own identifier, echoed back in the webhook when tapped (e.g. "menu_claim"). */
  id: string;
  /** Visible label on the button. WhatsApp caps this at 20 characters. */
  title: string;
}

/** One row inside a list section. WhatsApp allows at most 10 rows total per message. */
export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  /** Optional header shown above this group of rows. */
  title?: string;
  rows: ListRow[];
}

export class WhatsAppClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly graphApiVersion: string;

  constructor(options?: {
    phoneNumberId?: string;
    token?: string;
    graphApiVersion?: string;
  }) {
    const phoneNumberId = options?.phoneNumberId ?? config.PHONE_NUMBER_ID;
    const version = options?.graphApiVersion ?? config.GRAPH_API_VERSION;
    this.token = options?.token ?? config.WHATSAPP_TOKEN;
    this.graphApiVersion = version;
    this.baseUrl = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  }

  /**
   * Shared POST logic: logs the request, logs the response, throws a clear
   * error on failure. Protected (not private) so a test double can override
   * just this seam — the real send* methods (and their validation) still
   * run unmodified, only the actual network call is swapped out.
   */
  protected async post(body: unknown): Promise<unknown> {
    console.log("[whatsapp] -> POST /messages", JSON.stringify(body));

    const response = await this.fetchWithRetry(body);

    const responseBody: unknown = await response.json().catch(() => undefined);
    console.log(
      `[whatsapp] <- ${response.status} ${JSON.stringify(responseBody)}`,
    );

    if (!response.ok) {
      if (isMetaErrorResponse(responseBody)) {
        throw new WhatsAppApiError(
          responseBody.error.message,
          responseBody.error.code,
          responseBody.error.fbtrace_id,
        );
      }
      throw new WhatsAppApiError(
        `WhatsApp API request failed with status ${response.status}`,
        response.status,
      );
    }

    return responseBody;
  }

  /**
   * Retries only network-level failures (DNS, connection timeout/reset —
   * `fetch` itself throwing) with a short linear backoff. An HTTP error
   * *response* from Meta (4xx/5xx) is not retried here — `post()` handles
   * that separately, and those are usually not transient the way a dropped
   * connection is.
   */
  private async fetchWithRetry(body: unknown, attempt = 1): Promise<Response> {
    const maxAttempts = 3;
    try {
      return await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      const delayMs = 500 * attempt;
      console.warn(
        `[whatsapp] network error on attempt ${attempt}/${maxAttempts}, retrying in ${delayMs}ms:`,
        err,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return this.fetchWithRetry(body, attempt + 1);
    }
  }

  /**
   * Plain text message. `previewUrl` controls whether a link inside `body`
   * gets an unfurled preview card.
   *
   * `to` (here and on every other method below) is the recipient's number
   * in international format with no leading "+" and no spaces/dashes, e.g.
   * "919812345678" for a +91 98123 45678 number.
   */
  async sendText(to: string, body: string, previewUrl = false): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: previewUrl },
    });
  }

  /**
   * Sends an image by URL. Meta's servers fetch `imageUrl` themselves (it
   * must be public HTTPS) — you never upload bytes to Meta from this server.
   */
  async sendImage(to: string, imageUrl: string, caption?: string): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, caption },
    });
  }

  /** Same idea as sendImage, but for documents (PDF, etc). `filename` is what the user sees in their chat. */
  async sendDocument(
    to: string,
    documentUrl: string,
    filename?: string,
    caption?: string,
  ): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { link: documentUrl, filename, caption },
    });
  }

  /**
   * Up to 3 tappable buttons under a message. When the user taps one,
   * Meta sends YOUR `id` back in the webhook as `interactive.button_reply.id`
   * — that's how you know which button was pressed (see whatsapp/parse.ts).
   */
  async sendReplyButtons(
    to: string,
    bodyText: string,
    buttons: ReplyButton[],
  ): Promise<void> {
    if (buttons.length === 0 || buttons.length > 3) {
      throw new Error(
        `sendReplyButtons: WhatsApp allows 1-3 buttons, got ${buttons.length}`,
      );
    }
    for (const button of buttons) {
      assertMaxLength(button.title, 20, `Reply button title (id "${button.id}")`);
    }

    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.map((button) => ({
            type: "reply",
            reply: { id: button.id, title: button.title },
          })),
        },
      },
    });
  }

  /**
   * A scrollable list of options behind a single "menu" button — use this
   * instead of sendReplyButtons when you have more than 3 choices. Rows are
   * grouped into sections (each with an optional header); WhatsApp caps the
   * TOTAL rows across all sections at 10.
   */
  async sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
  ): Promise<void> {
    const totalRows = sections.reduce((sum, section) => sum + section.rows.length, 0);
    if (totalRows === 0 || totalRows > 10) {
      throw new Error(
        `sendList: WhatsApp allows 1-10 total rows across all sections, got ${totalRows}`,
      );
    }
    assertMaxLength(buttonText, 20, "List button text");
    for (const section of sections) {
      if (section.title) assertMaxLength(section.title, 24, "List section title");
      for (const row of section.rows) {
        assertMaxLength(row.title, 24, `List row title (id "${row.id}")`);
        if (row.description) {
          assertMaxLength(row.description, 72, `List row description (id "${row.id}")`);
        }
      }
    }

    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: sections.map((section) => ({
            title: section.title,
            rows: section.rows.map((row) => ({
              id: row.id,
              title: row.title,
              description: row.description,
            })),
          })),
        },
      },
    });
  }

  /**
   * A single button that opens a URL in the user's browser (NOT a reply —
   * tapping it doesn't come back through the webhook). Useful for linking
   * out to a web form, as opposed to sendReplyButtons which is for choices
   * you want to see an answer to.
   */
  async sendCtaUrl(
    to: string,
    bodyText: string,
    buttonText: string,
    url: string,
    headerText?: string,
  ): Promise<void> {
    assertMaxLength(buttonText, 20, "CTA button text");
    if (headerText) assertMaxLength(headerText, 60, "CTA header text");

    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "cta_url",
        header: headerText ? { type: "text", text: headerText } : undefined,
        body: { text: bodyText },
        action: {
          name: "cta_url",
          parameters: { display_text: buttonText, url },
        },
      },
    });
  }

  /**
   * A spoken reply, e.g. a text-to-speech response from the AI voice
   * handoff (see ai-voice-handoff-contract.html). Same "public HTTPS URL,
   * Meta fetches it" pattern as sendImage/sendDocument — the Cloud API's
   * audio message type has no caption field, unlike image/document.
   */
  async sendAudio(to: string, audioUrl: string): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { link: audioUrl },
    });
  }

  /**
   * Looks up a media id's short-lived download URL + metadata. The webhook
   * never carries media bytes inline, only an opaque id (see
   * IncomingMessage.mediaId) — this is the only way to turn that id into
   * something fetchable. Unlike every method above, this hits a different
   * Graph API endpoint (`/{media-id}`, not `/{phone-number-id}/messages`),
   * so it doesn't go through `post()`.
   *
   * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
   */
  async getMediaInfo(
    mediaId: string,
  ): Promise<{ url: string; mimeType: string; fileSizeBytes: number }> {
    const infoUrl = `https://graph.facebook.com/${this.graphApiVersion}/${mediaId}`;
    console.log(`[whatsapp] -> GET ${infoUrl}`);

    const response = await fetch(infoUrl, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const body: unknown = await response.json().catch(() => undefined);
    console.log(`[whatsapp] <- ${response.status} ${JSON.stringify(body)}`);

    if (!response.ok || !isMediaInfoResponse(body)) {
      if (isMetaErrorResponse(body)) {
        throw new WhatsAppApiError(body.error.message, body.error.code, body.error.fbtrace_id);
      }
      throw new WhatsAppApiError(
        `Failed to look up media ${mediaId} (status ${response.status})`,
        response.status,
      );
    }
    return { url: body.url, mimeType: body.mime_type, fileSizeBytes: body.file_size };
  }

  /**
   * Downloads the bytes from a URL returned by getMediaInfo, returned as
   * base64 (the shape the AI voice contract's `message.audio.data` wants —
   * see ai-voice-handoff-contract.html). That URL requires the SAME bearer
   * token as every other Graph API call and expires after a few minutes;
   * never cache or forward the URL itself, only what this downloads from it.
   */
  async downloadMediaAsBase64(mediaUrl: string): Promise<string> {
    const response = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new WhatsAppApiError(
        `Failed to download media (status ${response.status})`,
        response.status,
      );
    }
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes).toString("base64");
  }

  /**
   * Tells WhatsApp to show the blue double-checkmark "read" receipt for a
   * message the user sent us. Takes the incoming message's `id` (from
   * IncomingMessage.messageId) — not a message we sent.
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.post({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  }
}

/** Shared singleton, configured from validated env vars. Import this in routes. */
export const whatsAppClient = new WhatsAppClient();
