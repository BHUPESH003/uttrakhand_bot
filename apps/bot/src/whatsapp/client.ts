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
import {
  buildCarousel,
  buildCtaUrl,
  buildFlow,
  buildList,
  buildOrderDetails,
  buildOrderStatus,
  buildProduct,
  buildProductList,
  buildReplyButtons,
  type CarouselInput,
  type FlowInput,
  type ListSection,
  type OrderDetailsInput,
  type OrderStatusInput,
  type ProductInput,
  type ProductListInput,
  type ReplyButton,
} from "./messages";

export type { ReplyButton, ListRow, ListSection } from "./messages";

/**
 * Called with the recipient before every outbound send; throw to block it.
 * The default client has none — see commerce-demo/sendGuard.ts for the
 * demo's allowlist guard, which gets its own client instance so the
 * certificate service is never affected by demo flags.
 */
export type SendGuard = (to: string) => void;

/** "919812345678" -> "********5678" — full numbers never go to logs. */
export function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
}

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

/** Every successful send response looks like `{ messages: [{ id: "wamid...." }] }`. */
function extractWamid(response: unknown): string | undefined {
  const messages = (response as { messages?: { id?: string }[] } | undefined)?.messages;
  return messages?.[0]?.id;
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

/** sendOrderDetails/sendOrderStatus result: "demo" means Meta was not called (no WA_PAYMENT_CONFIG_NAME). */
export type PaymentSendResult = { provider: "demo" } | { provider: "whatsapp"; wamid: string | undefined };

export class WhatsAppClient {
  private readonly baseUrl: string;
  private readonly phoneNumberId: string;
  private readonly token: string;
  private readonly graphApiVersion: string;
  private readonly sendGuard?: SendGuard;
  private readonly paymentConfigName?: string;

  constructor(options?: {
    phoneNumberId?: string;
    token?: string;
    graphApiVersion?: string;
    sendGuard?: SendGuard;
    /** Defaults to config.WA_PAYMENT_CONFIG_NAME. Unset = payments use the demo provider, never Meta. */
    paymentConfigName?: string;
  }) {
    const phoneNumberId = options?.phoneNumberId ?? config.PHONE_NUMBER_ID;
    const version = options?.graphApiVersion ?? config.GRAPH_API_VERSION;
    this.token = options?.token ?? config.WHATSAPP_TOKEN;
    this.graphApiVersion = version;
    this.baseUrl = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    this.phoneNumberId = phoneNumberId;
    this.sendGuard = options?.sendGuard;
    this.paymentConfigName = options?.paymentConfigName ?? config.WA_PAYMENT_CONFIG_NAME;
  }

  /** Every outbound message goes through here: guard first, then the network seam. */
  private async send(body: { to: string; [key: string]: unknown }): Promise<unknown> {
    this.sendGuard?.(body.to);
    return this.post(body);
  }

  /**
   * Shared POST logic: logs the request, logs the response, throws a clear
   * error on failure. Protected (not private) so a test double can override
   * just this seam — the real send* methods (and their validation) still
   * run unmodified, only the actual network call is swapped out.
   */
  protected async post(body: unknown): Promise<unknown> {
    const to = (body as { to?: unknown }).to;
    const logged = typeof to === "string" ? { ...(body as object), to: maskPhone(to) } : body;
    console.log("[whatsapp] -> POST /messages", JSON.stringify(logged));

    const response = await this.fetchWithRetry(body);

    const responseBody: unknown = await response.json().catch(() => undefined);
    // Not the raw body: a success response carries contacts[].wa_id, the
    // recipient's full number.
    console.log(
      `[whatsapp] <- ${response.status}`,
      isMetaErrorResponse(responseBody)
        ? JSON.stringify(responseBody)
        : `wamid=${extractWamid(responseBody) ?? "-"}`,
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
    await this.send({
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
    await this.send({
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
    await this.send({
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
    await this.send(buildReplyButtons(to, { body: bodyText, buttons }));
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
    await this.send(buildList(to, { body: bodyText, buttonText, sections }));
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
    await this.send(buildCtaUrl(to, { body: bodyText, buttonText, url, headerText }));
  }

  /**
   * Opens a WhatsApp Flow. With flowAction "navigate" (default) it can open
   * on a given entry screen with initial data; with "data_exchange" the
   * Flow endpoint's INIT response decides the first screen — use that to
   * open on a screen that isn't an entry screen. Returns the wamid.
   */
  async sendFlow(to: string, input: FlowInput): Promise<string | undefined> {
    return extractWamid(await this.send(buildFlow(to, input)));
  }

  /** 2-10 horizontally scrolling image cards, each with one button. Returns the wamid. */
  async sendCarousel(to: string, input: CarouselInput): Promise<string | undefined> {
    return extractWamid(await this.send(buildCarousel(to, input)));
  }

  /** Multi-product message from a Meta Commerce catalog (max 30 products / 10 sections). */
  async sendProductList(to: string, input: ProductListInput): Promise<string | undefined> {
    return extractWamid(await this.send(buildProductList(to, input)));
  }

  /** Single-product message from a Meta Commerce catalog. */
  async sendProduct(to: string, input: ProductInput): Promise<string | undefined> {
    return extractWamid(await this.send(buildProduct(to, input)));
  }

  /**
   * WhatsApp Pay (India) order_details. Always validates; only calls Meta
   * when a payment configuration is set (WA_PAYMENT_CONFIG_NAME) —
   * otherwise returns { provider: "demo" } and the caller runs the demo
   * payment provider instead.
   */
  async sendOrderDetails(
    to: string,
    input: Omit<OrderDetailsInput, "configurationName">,
  ): Promise<PaymentSendResult> {
    const payload = buildOrderDetails(to, {
      ...input,
      // Placeholder only so the demo path still validates the rest of the order.
      configurationName: this.paymentConfigName ?? "demo",
    });
    if (!this.paymentConfigName) return { provider: "demo" };
    return { provider: "whatsapp", wamid: extractWamid(await this.send(payload)) };
  }

  /** Status update for an order_details message. Same WA_PAYMENT_CONFIG_NAME gate as sendOrderDetails. */
  async sendOrderStatus(to: string, input: OrderStatusInput): Promise<PaymentSendResult> {
    const payload = buildOrderStatus(to, input);
    if (!this.paymentConfigName) return { provider: "demo" };
    return { provider: "whatsapp", wamid: extractWamid(await this.send(payload)) };
  }

  /**
   * A spoken reply, e.g. a text-to-speech response from the AI voice
   * handoff (see ai-voice-handoff-contract.html). Same "public HTTPS URL,
   * Meta fetches it" pattern as sendImage/sendDocument — the Cloud API's
   * audio message type has no caption field, unlike image/document.
   *
   * Returns the sent message's wamid (when Meta's response includes one) so
   * a caller can wait for its actual delivery via whatsapp/deliveryTracker
   * — a 200 here only means Meta *queued* the message, not that it's
   * reached the device yet, which matters when something needs to render
   * after it (see flow/aiChat.ts).
   */
  async sendAudio(to: string, audioUrl: string): Promise<string | undefined> {
    const response = await this.send({
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { link: audioUrl },
    });
    return extractWamid(response);
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

  // ---------------------------------------------------------------------
  // Management calls (setup scripts only). Same Graph API, other endpoints:
  // business encryption key, Flows API, commerce settings. Verified against
  //   https://developers.facebook.com/docs/whatsapp/flows/reference/flowsapi
  //   https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/set-commerce-settings
  // ---------------------------------------------------------------------

  /**
   * One Graph API request to `/{version}/{path}`. Logs method, path and the
   * response body — management responses carry ids and statuses, no phone
   * numbers; the token is never logged. Throws WhatsAppApiError on non-2xx.
   */
  protected async graph(
    method: "GET" | "POST",
    path: string,
    options: { query?: Record<string, string>; json?: unknown; form?: URLSearchParams; multipart?: FormData } = {},
  ): Promise<unknown> {
    const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}/${path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    let body: string | URLSearchParams | FormData | undefined;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form; // fetch sets application/x-www-form-urlencoded
    } else if (options.multipart) {
      body = options.multipart; // fetch sets the multipart boundary
    }
    console.log(`[whatsapp] -> ${method} /${path}${url.search}`);
    const response = await fetch(url, { method, headers, body });
    const responseBody: unknown = await response.json().catch(() => undefined);
    console.log(`[whatsapp] <- ${response.status} ${JSON.stringify(responseBody)}`);
    if (!response.ok) {
      if (isMetaErrorResponse(responseBody)) {
        throw new WhatsAppApiError(responseBody.error.message, responseBody.error.code, responseBody.error.fbtrace_id);
      }
      throw new WhatsAppApiError(`Graph API ${method} /${path} failed with status ${response.status}`, response.status);
    }
    return responseBody;
  }

  /** Uploads the Flows endpoint's public key for this number (Meta signs it on upload). Form field: business_public_key. */
  async setBusinessPublicKey(publicKeyPem: string): Promise<unknown> {
    return this.graph("POST", `${this.phoneNumberId}/whatsapp_business_encryption`, {
      form: new URLSearchParams({ business_public_key: publicKeyPem }),
    });
  }

  /** `{ data: [{ business_public_key, business_public_key_signature_status: "VALID" | "MISMATCH" }] }` */
  async getBusinessPublicKey(): Promise<unknown> {
    return this.graph("GET", `${this.phoneNumberId}/whatsapp_business_encryption`);
  }

  /**
   * POST /{WABA-ID}/flows. Creates a DRAFT Flow (publish stays false) with its
   * JSON in the same request; the response carries `id` and any
   * `validation_errors`. There is no app parameter here — connect the app
   * afterwards with updateFlowMetadata({ applicationId }).
   */
  async createFlow(
    wabaId: string,
    input: { name: string; categories: string[]; endpointUri?: string; flowJson?: string },
  ): Promise<{ id?: string; success?: boolean; validation_errors?: unknown[] }> {
    return (await this.graph("POST", `${wabaId}/flows`, {
      json: { name: input.name, categories: input.categories, endpoint_uri: input.endpointUri, flow_json: input.flowJson },
    })) as { id?: string; success?: boolean; validation_errors?: unknown[] };
  }

  /** POST /{FLOW-ID}: name, categories, endpoint_uri, application_id (the Meta app connected to the Flow). */
  async updateFlowMetadata(
    flowId: string,
    input: { name?: string; categories?: string[]; endpointUri?: string; applicationId?: string },
  ): Promise<unknown> {
    return this.graph("POST", flowId, {
      json: {
        name: input.name,
        categories: input.categories,
        endpoint_uri: input.endpointUri,
        application_id: input.applicationId,
      },
    });
  }

  /** POST /{FLOW-ID}/assets as multipart: file + name "flow.json" + asset_type FLOW_JSON. Returns validation_errors. */
  async uploadFlowJson(flowId: string, flowJson: string): Promise<{ success?: boolean; validation_errors?: unknown[] }> {
    const form = new FormData();
    form.append("file", new Blob([flowJson], { type: "application/json" }), "flow.json");
    form.append("name", "flow.json");
    form.append("asset_type", "FLOW_JSON");
    return (await this.graph("POST", `${flowId}/assets`, { multipart: form })) as {
      success?: boolean;
      validation_errors?: unknown[];
    };
  }

  /** POST /{FLOW-ID}/publish. Irreversible: a published Flow can't be edited or deleted, only deprecated. */
  async publishFlow(flowId: string): Promise<unknown> {
    return this.graph("POST", `${flowId}/publish`);
  }

  /** GET /{FLOW-ID}?fields=... — status, validation_errors, health_status (for this number), endpoint_uri. (Not `preview`: its URL embeds an access token.) */
  async getFlow(flowId: string): Promise<unknown> {
    return this.graph("GET", flowId, {
      query: {
        fields: `id,name,status,categories,validation_errors,json_version,data_api_version,endpoint_uri,health_status.phone_number(${this.phoneNumberId})`,
      },
    });
  }

  /** `{ data: [{ is_cart_enabled, is_catalog_visible, id }] }` for this number. */
  async getCommerceSettings(): Promise<unknown> {
    return this.graph("GET", `${this.phoneNumberId}/whatsapp_commerce_settings`);
  }

  /** POST with query params is_cart_enabled / is_catalog_visible, per the docs. */
  async setCommerceSettings(input: { isCartEnabled?: boolean; isCatalogVisible?: boolean }): Promise<unknown> {
    const query: Record<string, string> = {};
    if (input.isCartEnabled !== undefined) query.is_cart_enabled = String(input.isCartEnabled);
    if (input.isCatalogVisible !== undefined) query.is_catalog_visible = String(input.isCatalogVisible);
    return this.graph("POST", `${this.phoneNumberId}/whatsapp_commerce_settings`, { query });
  }
}

/** Shared singleton, configured from validated env vars. Import this in routes. */
export const whatsAppClient = new WhatsAppClient();
