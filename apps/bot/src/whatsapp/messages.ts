/**
 * Pure builders + validators for every interactive payload WhatsAppClient
 * sends. Each `buildX(to, input)` runs `validateX(input)` first and throws a
 * PayloadValidationError listing every problem, so a bad message fails here
 * (and in tests) instead of as a 400 from Meta. Only whatsapp/client.ts
 * should call the builders — nothing else hand-writes Meta JSON.
 *
 * Limits are counted in UTF-16 code units (`string.length`), which is what
 * Meta counts — see flow/copy.ts for why that matters with Devanagari/emoji.
 *
 * Shapes and limits verified against Meta's docs (Nov 2026):
 *   reply buttons  https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 *   list           https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
 *   cta_url        https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-cta-url-messages
 *   flow           https://developers.facebook.com/docs/whatsapp/flows/guides/sendingaflow
 *   carousel       https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-media-carousel-messages
 *   product(s)     https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/single-product-messages
 *                  https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/multi-product-messages
 *   order_details / order_status
 *                  https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-in/pg
 */

export class PayloadValidationError extends Error {
  constructor(
    public readonly messageType: string,
    public readonly issues: string[],
  ) {
    super(`Invalid ${messageType} message:\n  - ${issues.join("\n  - ")}`);
    this.name = "PayloadValidationError";
  }
}

// ---------- shared checks ----------

function text(issues: string[], value: string | undefined, max: number, label: string, required = true): void {
  if (value === undefined) {
    if (required) issues.push(`${label} is required`);
    return;
  }
  if (value.trim() === "") issues.push(`${label} must not be empty`);
  else if (value.length > max) issues.push(`${label} exceeds ${max} characters (got ${value.length}): "${value}"`);
}

function count(issues: string[], n: number, min: number, max: number, label: string): void {
  if (n < min || n > max) issues.push(`${label}: need ${min}-${max}, got ${n}`);
}

function unique(issues: string[], values: string[], label: string): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) issues.push(`${label} must be unique, "${v}" repeats`);
    seen.add(v);
  }
}

function httpsUrl(issues: string[], value: string, label: string, allowHttp = false): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push(`${label} is not a valid URL: "${value}"`);
    return;
  }
  const ok = url.protocol === "https:" || (allowHttp && url.protocol === "http:");
  if (!ok) issues.push(`${label} must be ${allowHttp ? "http(s)" : "https"}: "${value}"`);
}

function build<T>(type: string, issues: string[], body: () => T): T {
  if (issues.length > 0) throw new PayloadValidationError(type, issues);
  return body();
}

function interactive(to: string, payload: Record<string, unknown>) {
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive", interactive: payload };
}

const footerOf = (footer?: string) => (footer === undefined ? undefined : { text: footer });

// ---------- reply buttons ----------

/** One button for sendReplyButtons. WhatsApp allows at most 3 per message. */
export interface ReplyButton {
  /** Your own identifier, echoed back in the webhook when tapped. Max 256. */
  id: string;
  /** Visible label. Max 20, unique within the message. */
  title: string;
}

export interface ReplyButtonsInput {
  body: string;
  buttons: ReplyButton[];
  footer?: string;
}

export function validateReplyButtons(input: ReplyButtonsInput): string[] {
  const issues: string[] = [];
  text(issues, input.body, 1024, "body");
  text(issues, input.footer, 60, "footer", false);
  count(issues, input.buttons.length, 1, 3, "buttons");
  for (const b of input.buttons) {
    text(issues, b.id, 256, `button id "${b.id}"`);
    text(issues, b.title, 20, `button title (id "${b.id}")`);
  }
  unique(issues, input.buttons.map((b) => b.id), "button ids");
  unique(issues, input.buttons.map((b) => b.title), "button titles");
  return issues;
}

export function buildReplyButtons(to: string, input: ReplyButtonsInput) {
  return build("reply buttons", validateReplyButtons(input), () =>
    interactive(to, {
      type: "button",
      body: { text: input.body },
      footer: footerOf(input.footer),
      action: { buttons: input.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
    }),
  );
}

// ---------- list ----------

export interface ListRow {
  /** Max 200, unique across the whole list. */
  id: string;
  /** Max 24. */
  title: string;
  /** Max 72. */
  description?: string;
}

export interface ListSection {
  /** Max 24. Required when there is more than one section. */
  title?: string;
  rows: ListRow[];
}

export interface ListInput {
  body: string;
  /** Label of the button that opens the list. Max 20. */
  buttonText: string;
  sections: ListSection[];
  header?: string;
  footer?: string;
}

export function validateList(input: ListInput): string[] {
  const issues: string[] = [];
  // Docs: list body is 4096, not the 1024 other interactive types use.
  text(issues, input.body, 4096, "body");
  text(issues, input.buttonText, 20, "list button text");
  text(issues, input.header, 60, "header", false);
  text(issues, input.footer, 60, "footer", false);
  count(issues, input.sections.length, 1, 10, "sections");
  const rows = input.sections.flatMap((s) => s.rows);
  count(issues, rows.length, 1, 10, "rows across all sections");
  for (const s of input.sections) {
    // Docs mark the title "Required"; one untitled section is what MAIN_MENU
    // has always sent successfully, so only multi-section lists enforce it.
    text(issues, s.title, 24, "section title", input.sections.length > 1);
    for (const r of s.rows) {
      text(issues, r.id, 200, `row id "${r.id}"`);
      text(issues, r.title, 24, `row title (id "${r.id}")`);
      text(issues, r.description, 72, `row description (id "${r.id}")`, false);
    }
  }
  unique(issues, rows.map((r) => r.id), "row ids");
  return issues;
}

export function buildList(to: string, input: ListInput) {
  return build("list", validateList(input), () =>
    interactive(to, {
      type: "list",
      header: input.header === undefined ? undefined : { type: "text", text: input.header },
      body: { text: input.body },
      footer: footerOf(input.footer),
      action: {
        button: input.buttonText,
        sections: input.sections.map((s) => ({
          title: s.title,
          rows: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
        })),
      },
    }),
  );
}

// ---------- cta_url ----------

export interface CtaUrlInput {
  body: string;
  /** Max 20. */
  buttonText: string;
  url: string;
  /** Text header, max 60. */
  headerText?: string;
  footer?: string;
}

export function validateCtaUrl(input: CtaUrlInput): string[] {
  const issues: string[] = [];
  text(issues, input.body, 1024, "body");
  text(issues, input.buttonText, 20, "CTA button text");
  text(issues, input.headerText, 60, "header", false);
  text(issues, input.footer, 60, "footer", false);
  // Docs set no scheme rule for the button URL; http stays allowed so existing callers can't break.
  httpsUrl(issues, input.url, "CTA url", true);
  return issues;
}

export function buildCtaUrl(to: string, input: CtaUrlInput) {
  return build("cta_url", validateCtaUrl(input), () =>
    interactive(to, {
      type: "cta_url",
      header: input.headerText ? { type: "text", text: input.headerText } : undefined,
      body: { text: input.body },
      footer: footerOf(input.footer),
      action: { name: "cta_url", parameters: { display_text: input.buttonText, url: input.url } },
    }),
  );
}

// ---------- flow ----------

export interface FlowInput {
  flowId: string;
  flowToken: string;
  /** Button text. Docs advise <= 30 chars, no emoji; enforced as a hard limit here. */
  flowCta: string;
  body: string;
  header?: string;
  footer?: string;
  /** Default "published". */
  mode?: "draft" | "published";
  /** Default "navigate". With "data_exchange" the endpoint's INIT response picks the first screen. */
  flowAction?: "navigate" | "data_exchange";
  /**
   * navigate only: first screen + its data. Docs: the screen "needs to be an
   * entry screen" (no inbound edge in routing_model). Omit to use the Flow's
   * default first screen. To open on a non-entry screen, use data_exchange
   * and return that screen from INIT.
   */
  screen?: string;
  data?: Record<string, unknown>;
}

export function validateFlow(input: FlowInput): string[] {
  const issues: string[] = [];
  text(issues, input.flowId, 100, "flow_id");
  text(issues, input.flowToken, 1000, "flow_token");
  text(issues, input.flowCta, 30, "flow_cta");
  text(issues, input.body, 1024, "body");
  text(issues, input.header, 60, "header", false);
  text(issues, input.footer, 60, "footer", false);
  const action = input.flowAction ?? "navigate";
  if (action !== "navigate" && (input.screen !== undefined || input.data !== undefined)) {
    issues.push("screen/data (flow_action_payload) is only allowed with flow_action navigate");
  }
  if (input.screen !== undefined) text(issues, input.screen, 100, "screen");
  if (input.data !== undefined && Object.keys(input.data).length === 0) {
    issues.push("data must be a non-empty object when provided");
  }
  return issues;
}

export function buildFlow(to: string, input: FlowInput) {
  const action = input.flowAction ?? "navigate";
  const hasPayload = action === "navigate" && (input.screen !== undefined || input.data !== undefined);
  return build("flow", validateFlow(input), () =>
    interactive(to, {
      type: "flow",
      header: input.header === undefined ? undefined : { type: "text", text: input.header },
      body: { text: input.body },
      footer: footerOf(input.footer),
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: input.flowId,
          flow_token: input.flowToken,
          flow_cta: input.flowCta,
          mode: input.mode ?? "published",
          flow_action: action,
          flow_action_payload: hasPayload
            ? {
                screen: input.screen,
                // Docs' reference table + example: "a non-empty JSON object serialized as a string".
                data: input.data === undefined ? undefined : JSON.stringify(input.data),
              }
            : undefined,
        },
      },
    }),
  );
}

// ---------- carousel ----------

export type CarouselButton =
  | { kind: "cta_url"; displayText: string; url: string }
  | { kind: "quick_reply"; id: string; title: string };

export interface CarouselCard {
  /** Public https image. */
  imageUrl: string;
  /** Max 160 chars, max 2 line breaks. */
  body?: string;
  /** Docs: exactly one cta_url button, or one or more quick_reply buttons. */
  buttons: CarouselButton[];
}

export interface CarouselInput {
  body: string;
  /** 2-10 cards; card_index is assigned from array order. Docs: button types and counts must match across all cards. */
  cards: CarouselCard[];
}

export function validateCarousel(input: CarouselInput): string[] {
  const issues: string[] = [];
  text(issues, input.body, 1024, "body");
  count(issues, input.cards.length, 2, 10, "cards");
  input.cards.forEach((card, i) => {
    const label = `card ${i}`;
    httpsUrl(issues, card.imageUrl, `${label} image`);
    text(issues, card.body, 160, `${label} body`, false);
    if (card.body && card.body.split("\n").length - 1 > 2) issues.push(`${label} body has more than 2 line breaks`);
    if (card.buttons.length === 0) issues.push(`${label} needs a button`);
    if (card.buttons.some((b) => b.kind === "cta_url") && card.buttons.length > 1) {
      issues.push(`${label}: a cta_url card has exactly one button`);
    }
    for (const button of card.buttons) {
      if (button.kind === "cta_url") {
        text(issues, button.displayText, 20, `${label} button text`);
        httpsUrl(issues, button.url, `${label} button url`);
      } else {
        text(issues, button.id, 256, `${label} quick reply id`);
        text(issues, button.title, 20, `${label} quick reply title`);
      }
    }
    unique(issues, card.buttons.flatMap((b) => (b.kind === "quick_reply" ? [b.title] : [])), `${label} quick reply titles`);
  });
  const shapes = new Set(input.cards.map((c) => c.buttons.map((b) => b.kind).join(",")));
  if (shapes.size > 1) issues.push("all cards must have the same button types and count");
  unique(
    issues,
    input.cards.flatMap((c) => c.buttons.flatMap((b) => (b.kind === "quick_reply" ? [b.id] : []))),
    "quick reply ids",
  );
  return issues;
}

export function buildCarousel(to: string, input: CarouselInput) {
  return build("carousel", validateCarousel(input), () =>
    interactive(to, {
      type: "carousel",
      body: { text: input.body },
      action: {
        cards: input.cards.map((card, i) => ({
          card_index: i,
          // Docs set card-level type "cta_url" on every card, quick-reply
          // cards included (both examples + request syntax). A secondary source
          // claims Meta rejects it on quick_reply cards; unverified live —
          // if Meta 400s a quick-reply carousel, drop this field for those cards.
          type: "cta_url",
          header: { type: "image", image: { link: card.imageUrl } },
          body: card.body === undefined ? undefined : { text: card.body },
          action:
            card.buttons[0]!.kind === "cta_url"
              ? { name: "cta_url", parameters: { display_text: card.buttons[0]!.displayText, url: card.buttons[0]!.url } }
              : {
                  buttons: card.buttons.map((b) =>
                    b.kind === "quick_reply" ? { type: "quick_reply", quick_reply: { id: b.id, title: b.title } } : null,
                  ),
                },
        })),
      },
    }),
  );
}

// ---------- catalog products ----------

export interface ProductListInput {
  catalogId: string;
  /** Required, text, max 60. */
  header: string;
  body: string;
  footer?: string;
  /** Max 10 sections, max 30 products total. */
  sections: { title: string; productRetailerIds: string[] }[];
}

export function validateProductList(input: ProductListInput): string[] {
  const issues: string[] = [];
  text(issues, input.catalogId, 100, "catalog_id");
  text(issues, input.header, 60, "header");
  text(issues, input.body, 1024, "body");
  text(issues, input.footer, 60, "footer", false);
  count(issues, input.sections.length, 1, 10, "sections");
  const ids = input.sections.flatMap((s) => s.productRetailerIds);
  count(issues, ids.length, 1, 30, "products across all sections");
  for (const s of input.sections) {
    text(issues, s.title, 24, "section title");
    if (s.productRetailerIds.length === 0) issues.push(`section "${s.title}" has no products`);
    for (const id of s.productRetailerIds) text(issues, id, 100, "product_retailer_id");
  }
  unique(issues, ids, "product_retailer_ids");
  return issues;
}

export function buildProductList(to: string, input: ProductListInput) {
  return build("product_list", validateProductList(input), () =>
    interactive(to, {
      type: "product_list",
      header: { type: "text", text: input.header },
      body: { text: input.body },
      footer: footerOf(input.footer),
      action: {
        catalog_id: input.catalogId,
        sections: input.sections.map((s) => ({
          title: s.title,
          product_items: s.productRetailerIds.map((id) => ({ product_retailer_id: id })),
        })),
      },
    }),
  );
}

export interface ProductInput {
  catalogId: string;
  productRetailerId: string;
  /** Optional. No header is allowed on single-product messages. */
  body?: string;
  footer?: string;
}

export function validateProduct(input: ProductInput): string[] {
  const issues: string[] = [];
  text(issues, input.catalogId, 100, "catalog_id");
  text(issues, input.productRetailerId, 100, "product_retailer_id");
  text(issues, input.body, 1024, "body", false);
  text(issues, input.footer, 60, "footer", false);
  return issues;
}

export function buildProduct(to: string, input: ProductInput) {
  return build("product", validateProduct(input), () =>
    interactive(to, {
      type: "product",
      body: input.body === undefined ? undefined : { text: input.body },
      footer: footerOf(input.footer),
      action: { catalog_id: input.catalogId, product_retailer_id: input.productRetailerId },
    }),
  );
}

// ---------- payments (India): order_details / order_status ----------

/** Money in paise (₹12.34 = 1234). Meta's offset for INR is always 100. */
const money = (paise: number) => ({ value: paise, offset: 100 });

export type PaymentGateway = "razorpay" | "payu" | "billdesk" | "zaakpay";

export interface OrderItem {
  name: string;
  amountPaise: number;
  quantity: number;
  salePaise?: number;
  retailerId?: string;
  /** Required on every item when no catalogId is given. */
  countryOfOrigin?: string;
  importerName?: string;
  importerAddress?: string;
}

export interface OrderDetailsInput {
  /** Unique per order_details message. [A-Za-z0-9_.-], max 35. */
  referenceId: string;
  goodsType: "digital-goods" | "physical-goods";
  gateway: PaymentGateway;
  /** Must match a payment configuration in Meta Business Suite. Max 60. */
  configurationName: string;
  body: string;
  footer?: string;
  catalogId?: string;
  items: OrderItem[];
  taxPaise: number;
  taxDescription?: string;
  shippingPaise?: number;
  discountPaise?: number;
  discountDescription?: string;
  /** UTC epoch seconds, at least 300s in the future. */
  expiresAt?: number;
  expirationDescription?: string;
}

const lineTotal = (i: OrderItem) => (i.salePaise ?? i.amountPaise) * i.quantity;

export function orderSubtotalPaise(input: Pick<OrderDetailsInput, "items">): number {
  return input.items.reduce((sum, i) => sum + lineTotal(i), 0);
}

/** Docs: total_amount = subtotal + tax + shipping - discount. */
export function orderTotalPaise(input: OrderDetailsInput): number {
  return orderSubtotalPaise(input) + input.taxPaise + (input.shippingPaise ?? 0) - (input.discountPaise ?? 0);
}

function paise(issues: string[], value: number | undefined, label: string, min = 0): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < min) issues.push(`${label} must be an integer >= ${min} paise, got ${value}`);
}

export function validateOrderDetails(input: OrderDetailsInput, nowSeconds = Math.floor(Date.now() / 1000)): string[] {
  const issues: string[] = [];
  if (!/^[A-Za-z0-9_.-]{1,35}$/.test(input.referenceId)) {
    issues.push(`reference_id must be 1-35 chars of letters, numbers, _ - . (got "${input.referenceId}")`);
  }
  text(issues, input.configurationName, 60, "configuration_name");
  text(issues, input.body, 1024, "body");
  text(issues, input.footer, 60, "footer", false);
  if (input.items.length === 0) issues.push("items: need at least 1");
  for (const item of input.items) {
    text(issues, item.name, 60, "item name");
    paise(issues, item.amountPaise, `item "${item.name}" amount`, 1);
    paise(issues, item.salePaise, `item "${item.name}" sale amount`, 1);
    if (item.salePaise !== undefined && item.salePaise >= item.amountPaise) {
      issues.push(`item "${item.name}" sale amount must be less than amount`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      issues.push(`item "${item.name}" quantity must be a positive integer`);
    }
    if (!input.catalogId && !(item.countryOfOrigin && item.importerName && item.importerAddress)) {
      issues.push(`item "${item.name}" needs countryOfOrigin, importerName and importerAddress when no catalogId is set`);
    }
  }
  paise(issues, input.taxPaise, "tax");
  paise(issues, input.shippingPaise, "shipping");
  paise(issues, input.discountPaise, "discount");
  text(issues, input.taxDescription, 60, "tax description", false);
  text(issues, input.discountDescription, 60, "discount description", false);
  if (input.items.length > 0 && orderTotalPaise(input) < 1) issues.push("total amount must be positive");
  if (input.expiresAt !== undefined && input.expiresAt - nowSeconds < 300) {
    issues.push("expiration must be at least 300 seconds in the future");
  }
  text(issues, input.expirationDescription, 120, "expiration description", false);
  return issues;
}

export function buildOrderDetails(to: string, input: OrderDetailsInput, nowSeconds?: number) {
  return build("order_details", validateOrderDetails(input, nowSeconds), () =>
    interactive(to, {
      type: "order_details",
      body: { text: input.body },
      footer: footerOf(input.footer),
      action: {
        name: "review_and_pay",
        // Docs conflict: a warning says parameters is "a stringified JSON
        // object", but every example on the same page sends an object. We
        // follow the examples; flip to JSON.stringify here if Meta rejects it.
        parameters: {
          reference_id: input.referenceId,
          type: input.goodsType,
          payment_settings: [
            {
              type: "payment_gateway",
              payment_gateway: { type: input.gateway, configuration_name: input.configurationName },
            },
          ],
          currency: "INR",
          total_amount: money(orderTotalPaise(input)),
          order: {
            status: "pending",
            catalog_id: input.catalogId,
            items: input.items.map((i) => ({
              retailer_id: i.retailerId,
              name: i.name,
              amount: money(i.amountPaise),
              sale_amount: i.salePaise === undefined ? undefined : money(i.salePaise),
              quantity: i.quantity,
              country_of_origin: i.countryOfOrigin,
              importer_name: i.importerName,
              // Docs spell this field "importer_adress" in one table and
              // "importer_address" in the catalog note; using the latter.
              importer_address: i.importerAddress,
            })),
            subtotal: money(orderSubtotalPaise(input)),
            tax: { ...money(input.taxPaise), description: input.taxDescription },
            shipping: input.shippingPaise === undefined ? undefined : money(input.shippingPaise),
            discount:
              input.discountPaise === undefined
                ? undefined
                : { ...money(input.discountPaise), description: input.discountDescription },
            expiration:
              input.expiresAt === undefined
                ? undefined
                : { timestamp: String(input.expiresAt), description: input.expirationDescription },
          },
        },
      },
    }),
  );
}

export type OrderStatusValue = "processing" | "partially_shipped" | "shipped" | "completed" | "canceled";
const ORDER_STATUSES: OrderStatusValue[] = ["processing", "partially_shipped", "shipped", "completed", "canceled"];

export interface OrderStatusInput {
  /** Same reference_id as the order_details message. */
  referenceId: string;
  status: OrderStatusValue;
  body: string;
  footer?: string;
  /** Max 120. */
  description?: string;
}

export function validateOrderStatus(input: OrderStatusInput): string[] {
  const issues: string[] = [];
  if (!/^[A-Za-z0-9_.-]{1,35}$/.test(input.referenceId)) issues.push(`invalid reference_id "${input.referenceId}"`);
  if (!ORDER_STATUSES.includes(input.status)) issues.push(`status must be one of ${ORDER_STATUSES.join(", ")}`);
  text(issues, input.body, 1024, "body");
  text(issues, input.footer, 60, "footer", false);
  text(issues, input.description, 120, "description", false);
  return issues;
}

export function buildOrderStatus(to: string, input: OrderStatusInput) {
  return build("order_status", validateOrderStatus(input), () =>
    interactive(to, {
      type: "order_status",
      body: { text: input.body },
      footer: footerOf(input.footer),
      action: {
        name: "review_order",
        parameters: {
          reference_id: input.referenceId,
          order: { status: input.status, description: input.description },
        },
      },
    }),
  );
}
