/**
 * The commerce demo's conversation: declarative FlowStates (same contract as
 * flow/definition.ts, which spreads these in) plus the global router for
 * its prefixed button ids and completed Flows.
 *
 *   J1 COMMERCE_MENU          Buy / Track order / Check balance
 *   J2 COMMERCE_BUY           brand carousel (quick replies "view:{brandId}")
 *      COMMERCE_BRAND         Flow button "Choose amount" -> Flow opens on ITEM
 *   J3 COMMERCE_SUMMARY       after the Flow (nfm_reply): summary + Pay / Cancel
 *      COMMERCE_PAY           DemoPaymentProvider; asks the demo OTP when points are used
 *      COMMERCE_PAID          marks paid, issues the code (monospace), Buy another / Track
 *      COMMERCE_CANCEL
 *   J4 COMMERCE_TRACK         list of recent orders ("order:{id}")
 *      COMMERCE_ORDER_STATUS  status steps + code when delivered
 *   J5 COMMERCE_BALANCE       demo points balance
 *   J6 "hi"/"menu" -> COMMERCE_MENU, unknown input -> commerce_help (engine, via `group`)
 *
 * Catalog path (COMMERCE_CATALOG_ENABLED), next to the Flow path:
 *      COMMERCE_CATALOG       multi-product message (one section per brand) + "Other amount"
 *      COMMERCE_OTHER_AMOUNT  Flow opened on OTHER_AMOUNT (brand + typed amount)
 *      COMMERCE_PRODUCT       single-product message, from a carousel card
 *      COMMERCE_CART          cart (order webhook) -> demo order(s) -> J3 summary
 *
 * Every state belongs to COMMERCE_GROUP, so the engine sends through
 * demoWhatsAppClient: the demo send guard applies to all of it, and every
 * message is validated by the client before it's sent.
 */
import { config } from "../config";
import { executeAction } from "../flow/actions";
import { backToMenuButton } from "../flow/backToMenu";
import { resolveCopy } from "../flow/copy";
import type { CopyKey } from "../flow/copy";
import type { FlowContext, FlowGroup, FlowState, OutgoingAction } from "../flow/types";
import {
  catalogSections,
  dataset,
  DEMO_FAILURE_TRIGGERS,
  featuredAmount,
  findBrand,
  formatRupees,
  newDemoOrder,
  orderStore,
  parseRetailerId,
  pointsLedger,
  priceOrder,
  PROMOS,
  retailerIdFor,
  type Order,
  type OrderStatus,
} from "./data";
import { flowConfig } from "./config";
import { screenData } from "./flowHandler";
import { DemoPaymentProvider, DEMO_OTP, type PaymentIntent, type PaymentProvider } from "./payments";
import { demoWhatsAppClient } from "./sendGuard";
import { commerceSessions, flowTokenFor, sessionIdFromToken } from "./sessions";

export const COMMERCE_MENU_STATE_KEY = "COMMERCE_MENU";
const BUY = "COMMERCE_BUY";
const BRAND = "COMMERCE_BRAND";
const SUMMARY = "COMMERCE_SUMMARY";
const PAY = "COMMERCE_PAY";
const PAID = "COMMERCE_PAID";
const CANCEL = "COMMERCE_CANCEL";
const TRACK = "COMMERCE_TRACK";
const ORDER_STATUS = "COMMERCE_ORDER_STATUS";
const BALANCE = "COMMERCE_BALANCE";
const CATALOG = "COMMERCE_CATALOG";
const OTHER_AMOUNT = "COMMERCE_OTHER_AMOUNT";
const PRODUCT = "COMMERCE_PRODUCT";
const CART = "COMMERCE_CART";

/** Button/row id prefixes, routed from any state by routeCommerceInput. */
const ID = {
  buy: "c:buy",
  track: "c:track",
  balance: "c:balance",
  view: "view:", // view:{brandId}
  pay: "pay:", // pay:{orderId}
  cancel: "cancel:", // cancel:{orderId}
  order: "order:", // order:{orderId}
  catalog: "c:catalog",
  other: "c:other",
  product: "product:", // product:{brandId}
} as const;

const catalogOn = () => config.COMMERCE_CATALOG_ENABLED && Boolean(config.COMMERCE_CATALOG_ID);

export const COMMERCE_GROUP: FlowGroup = {
  menuKey: COMMERCE_MENU_STATE_KEY,
  helpKey: "commerce_help",
  client: demoWhatsAppClient,
};

export const paymentProvider: PaymentProvider = new DemoPaymentProvider(pointsLedger);

/** What the commerce journeys keep on the engine session (session.data.commerce). */
interface CommerceData {
  brandId?: string;
  orderId?: string;
  paymentId?: string;
  otpError?: boolean;
  /** A received cart, until COMMERCE_CART turns it into orders. */
  cart?: NonNullable<FlowContext["message"]["order"]>;
}

function cdata(ctx: FlowContext): CommerceData {
  ctx.session.data.commerce ??= {};
  return ctx.session.data.commerce as CommerceData;
}

/** The order in session, only if it belongs to this user. */
function ownedOrder(ctx: FlowContext): Order | undefined {
  const order = orderStore.get(cdata(ctx).orderId ?? "");
  return order?.userId === ctx.session.userId ? order : undefined;
}

const statusLabel = (ctx: FlowContext, status: OrderStatus) => ctx.t(`commerce_status_${status}` as CopyKey);
const points = (n: number) => n.toLocaleString("en-IN");
/** WhatsApp monospace — free-form messages have no copy button, so codes go in ```...``` to long-press copy. */
const monospace = (codes: string[]) => codes.map((c) => "```" + c + "```").join("\n");
const promoOf = (order: Order) => PROMOS.find((p) => p.code === order.promoCode) ?? null;

function menuButtons(ctx: FlowContext, body: string): OutgoingAction {
  return {
    kind: "sendReplyButtons",
    body,
    buttons: [
      { id: ID.buy, title: ctx.t("commerce_buy") },
      { id: ID.track, title: ctx.t("commerce_track") },
      { id: ID.balance, title: ctx.t("commerce_balance") },
    ],
  };
}

function afterPurchaseButtons(ctx: FlowContext): OutgoingAction {
  return {
    kind: "sendReplyButtons",
    body: ctx.t("commerce_next_body"),
    buttons: [
      { id: ID.buy, title: ctx.t("commerce_buy_another") },
      { id: ID.track, title: ctx.t("commerce_track") },
    ],
  };
}

const notFound = (ctx: FlowContext): OutgoingAction[] => [
  menuButtons(ctx, ctx.t("commerce_order_not_found")),
];

/** Points-first split for this order at the user's current available balance. */
function splitFor(ctx: FlowContext, order: Order) {
  return priceOrder(order.amount, order.qty, promoOf(order), "split", pointsLedger.available(ctx.session.userId));
}

/**
 * Payment confirmed: mark the order paid, issue the code(s). Demo
 * triggers (data/orders.ts): qty 9 replays the payment-success event (the
 * order store absorbs it, so one delivery); qty 7 fails issuance -> refund.
 */
async function settle(ctx: FlowContext, order: Order, intent: PaymentIntent): Promise<OutgoingAction[]> {
  const events = order.qty === DEMO_FAILURE_TRIGGERS.duplicateEventQty ? 2 : 1;
  for (let i = 0; i < events; i++) {
    if (orderStore.markPaid(order.id).duplicate) {
      console.log(`[commerce] duplicate payment event absorbed for ${order.id}`);
    }
  }
  orderStore.fulfil(order.id);

  if (order.status === "failed") {
    await paymentProvider.refund(intent.id);
    return [menuButtons(ctx, ctx.t("commerce_issue_failed", { order: order.id }))];
  }
  const brand = findBrand(dataset, order.brandId);
  return [
    {
      kind: "sendText",
      text: ctx.t("commerce_delivered", {
        order: order.id,
        item: brand?.itemName ?? "",
        codes: monospace(order.codes),
      }),
    },
    afterPurchaseButtons(ctx),
  ];
}

/** A commerce state: in COMMERCE_GROUP; handleInput defaults to "not understood" (-> group help). */
/** J3 summary for one pending order: points-first split, Pay (demo) / Cancel order. */
function summaryActions(ctx: FlowContext, order: Order): OutgoingAction {
  const brand = findBrand(dataset, order.brandId);
  const promo = promoOf(order);
  const split = splitFor(ctx, order);
  return {
    kind: "sendReplyButtons",
    body: ctx.t("commerce_summary_body", {
      order: order.id,
      brand: brand?.name ?? "",
      item: brand?.itemName ?? "",
      amount: formatRupees(order.amount),
      qty: String(order.qty),
      subtotal: formatRupees(split.subtotal),
      offer_line: promo ? ctx.t("commerce_summary_offer", { code: promo.code, discount: formatRupees(split.discount) }) : "",
      total: formatRupees(split.total),
      points: points(split.pointsUsed),
      online: formatRupees(split.onlineDue),
    }),
    buttons: [
      { id: `${ID.pay}${order.id}`, title: ctx.t("commerce_pay") },
      { id: `${ID.cancel}${order.id}`, title: ctx.t("commerce_cancel_order") },
    ],
  };
}

/**
 * Opens the commerce Flow (navigate) on `screen` with that screen's data —
 * or explains it's unavailable. This is where a Flow session starts, so this
 * is where the admin flags are snapshotted (data for ITEM is computed now).
 */
function flowMessage(
  ctx: FlowContext,
  screen: "ITEM" | "OTHER_AMOUNT",
  body: string,
  brandId?: string,
  mode: "draft" | "published" = config.COMMERCE_FLOW_MODE,
): OutgoingAction[] {
  if (!config.COMMERCE_FLOW_ID) return [menuButtons(ctx, ctx.t("commerce_flow_unavailable"))];
  const options = flowConfig.get();
  if (screen === "OTHER_AMOUNT" && !options.customAmount) return [menuButtons(ctx, ctx.t("commerce_menu_body"))];
  const flowSession = commerceSessions.create({ userId: ctx.session.userId, brandId, startScreen: screen, options });
  return [
    {
      kind: "sendFlow",
      flowId: config.COMMERCE_FLOW_ID,
      flowToken: flowTokenFor(flowSession),
      flowCta: ctx.t(screen === "ITEM" ? "commerce_choose_amount" : "commerce_other_amount"),
      body,
      mode,
      flowAction: "navigate",
      screen,
      data: screenData(screen, flowSession, dataset),
    },
  ];
}

const state = (
  key: string,
  s: Pick<FlowState, "onEnter"> & Partial<Pick<FlowState, "handleInput">>,
): FlowState => ({
  key,
  group: COMMERCE_GROUP,
  onEnter: s.onEnter,
  handleInput: s.handleInput ?? (() => null),
});

export const commerceStates: Record<string, FlowState> = {
  // J1
  [COMMERCE_MENU_STATE_KEY]: state(COMMERCE_MENU_STATE_KEY, {
    onEnter: (ctx) => [menuButtons(ctx, ctx.t("commerce_menu_body")), backToMenuButton(ctx)],
  }),

  // J2
  [BUY]: state(BUY, {
    onEnter: (ctx): OutgoingAction[] => [
      {
        kind: "sendCarousel",
        body: ctx.t("commerce_carousel_body"),
        cards: dataset.brands.map((brand) => ({
          imageUrl: brand.imageUrl,
          body: ctx.t("commerce_card_body", { brand: brand.name, category: brand.category, item: brand.itemName }),
          buttons: [
            { kind: "quick_reply", id: `${ID.view}${brand.id}`, title: ctx.t("commerce_select") },
            // Catalog alternative to the Flow button: the brand's single product.
            ...(catalogOn()
              ? [{ kind: "quick_reply" as const, id: `${ID.product}${brand.id}`, title: ctx.t("commerce_view_product") }]
              : []),
          ],
        })),
      },
      ...(catalogOn()
        ? [
            {
              kind: "sendReplyButtons" as const,
              body: ctx.t("commerce_catalog_prompt"),
              buttons: [{ id: ID.catalog, title: ctx.t("commerce_browse_catalog") }],
            },
          ]
        : []),
    ],
  }),

  [BRAND]: state(BRAND, {
    onEnter: (ctx) => {
      const brand = findBrand(dataset, cdata(ctx).brandId ?? "");
      if (!brand) return [menuButtons(ctx, ctx.t("commerce_menu_body"))];
      return flowMessage(ctx, "ITEM", ctx.t("commerce_brand_body", { brand: brand.name, item: brand.itemName }), brand.id);
    },
  }),

  // Catalog path
  [CATALOG]: state(CATALOG, {
    onEnter: (ctx) => [
      {
        kind: "sendProductList",
        catalogId: config.COMMERCE_CATALOG_ID!,
        header: ctx.t("commerce_catalog_header"),
        body: ctx.t("commerce_catalog_body"),
        sections: catalogSections(dataset),
      },
      // A catalog only has fixed prices, so a free amount is offered next to
      // it — unless the admin turned custom amounts off.
      ...(flowConfig.get().customAmount
        ? [
            {
              kind: "sendReplyButtons" as const,
              body: ctx.t("commerce_other_amount_prompt"),
              buttons: [{ id: ID.other, title: ctx.t("commerce_other_amount") }],
            },
          ]
        : []),
    ],
  }),

  [OTHER_AMOUNT]: state(OTHER_AMOUNT, {
    onEnter: (ctx) => flowMessage(ctx, "OTHER_AMOUNT", ctx.t("commerce_other_amount_body")),
  }),

  [PRODUCT]: state(PRODUCT, {
    onEnter: (ctx) => {
      const brand = findBrand(dataset, cdata(ctx).brandId ?? "");
      if (!brand) return [menuButtons(ctx, ctx.t("commerce_menu_body"))];
      const amount = featuredAmount(brand);
      return [
        {
          kind: "sendProduct",
          catalogId: config.COMMERCE_CATALOG_ID!,
          productRetailerId: retailerIdFor(brand, amount),
          body: ctx.t("commerce_product_body", { item: brand.itemName, amount: formatRupees(amount) }),
        },
      ];
    },
  }),

  // Cart (order webhook): one demo order per valid line, built exactly like a
  // Flow order (newDemoOrder), then the usual J3 summary for each.
  [CART]: state(CART, {
    onEnter: (ctx) => {
      const c = cdata(ctx);
      const cart = c.cart;
      delete c.cart;
      if (!cart) return [menuButtons(ctx, ctx.t("commerce_menu_body"))];

      const { maxQty } = flowConfig.get();
      const skipped: string[] = [];
      const orders: Order[] = [];
      for (const item of cart.items) {
        const product = cart.catalogId === config.COMMERCE_CATALOG_ID ? parseRetailerId(dataset, item.retailerId) : undefined;
        const qtyOk = Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= maxQty;
        if (!product || !qtyOk) {
          skipped.push(item.retailerId || "?");
          continue;
        }
        if (item.currency !== "INR" || item.itemPrice !== product.amount) {
          // Our data module is the source of truth for prices; the catalog may lag.
          console.warn(`[commerce] cart price ${item.itemPrice} ${item.currency} != ${product.amount} INR for ${item.retailerId}; using ours`);
        }
        orders.push(
          orderStore.create(
            newDemoOrder({ userId: ctx.session.userId, brandId: product.brand.id, amount: product.amount, qty: item.quantity, promo: null }),
          ),
        );
      }

      const actions: OutgoingAction[] = [];
      if (skipped.length > 0) {
        actions.push({ kind: "sendText", text: ctx.t("commerce_cart_skipped", { items: skipped.join(", ") }) });
      }
      if (orders.length === 0) return [...actions, menuButtons(ctx, ctx.t("commerce_cart_empty"))];
      c.orderId = orders.at(-1)!.id;
      return [...actions, ...orders.map((order) => summaryActions(ctx, order))];
    },
  }),

  // J3
  [SUMMARY]: state(SUMMARY, {
    onEnter: (ctx) => {
      const order = ownedOrder(ctx);
      if (!order) return notFound(ctx);
      if (order.status !== "pending_payment") {
        return [menuButtons(ctx, ctx.t("commerce_already", { order: order.id, status: statusLabel(ctx, order.status) }))];
      }
      return [summaryActions(ctx, order)];
    },
  }),

  [PAY]: state(PAY, {
    onEnter: async (ctx) => {
      const order = ownedOrder(ctx);
      if (!order) return notFound(ctx);
      if (order.status !== "pending_payment") {
        return [menuButtons(ctx, ctx.t("commerce_already", { order: order.id, status: statusLabel(ctx, order.status) }))];
      }
      const split = splitFor(ctx, order);
      const intent = await paymentProvider.initiate(order, { pointsUsed: split.pointsUsed, onlineDue: split.onlineDue });
      const c = cdata(ctx);
      c.paymentId = intent.id;

      if (intent.requiresOtp) {
        const wrong = c.otpError === true;
        c.otpError = false;
        return [
          {
            kind: "sendText",
            text: wrong
              ? ctx.t("commerce_otp_wrong", { otp: DEMO_OTP })
              : ctx.t("commerce_otp_prompt", { points: points(intent.pointsUsed), otp: DEMO_OTP }),
          },
        ];
      }
      // Online-only: nothing to verify in the demo, settle right away.
      const confirmed = await paymentProvider.confirm(intent.id);
      return confirmed.ok ? settle(ctx, order, confirmed.intent) : notFound(ctx);
    },
    // Waiting for the OTP. Anything that isn't an answer to a pending
    // OTP-protected payment falls back to the group help.
    handleInput: async (ctx) => {
      const c = cdata(ctx);
      const intent = paymentProvider.get(c.paymentId ?? "");
      if (ctx.message.type !== "text" || !intent || intent.status !== "pending" || !intent.requiresOtp) return null;
      const result = await paymentProvider.confirm(intent.id, ctx.message.text);
      if (result.ok) return PAID;
      if (result.reason === "wrong_otp") {
        c.otpError = true;
        return PAY;
      }
      return null;
    },
  }),

  [PAID]: state(PAID, {
    onEnter: async (ctx) => {
      const order = ownedOrder(ctx);
      const intent = paymentProvider.get(cdata(ctx).paymentId ?? "");
      if (!order || !intent || order.status !== "pending_payment") return notFound(ctx);
      return settle(ctx, order, intent);
    },
  }),

  [CANCEL]: state(CANCEL, {
    onEnter: async (ctx) => {
      const order = ownedOrder(ctx);
      if (!order) return notFound(ctx);
      if (order.status !== "pending_payment") {
        return [menuButtons(ctx, ctx.t("commerce_cannot_cancel", { order: order.id, status: statusLabel(ctx, order.status) }))];
      }
      orderStore.cancel(order.id);
      // Release any points held by a payment started for this order (e.g. OTP never entered).
      const intent = paymentProvider.get(cdata(ctx).paymentId ?? "");
      if (intent?.orderId === order.id) await paymentProvider.refund(intent.id);
      return [menuButtons(ctx, ctx.t("commerce_cancelled", { order: order.id }))];
    },
  }),

  // J4
  [TRACK]: state(TRACK, {
    onEnter: (ctx) => {
      const orders = orderStore.listForUser(ctx.session.userId).reverse().slice(0, 10);
      if (orders.length === 0) return [menuButtons(ctx, ctx.t("commerce_no_orders"))];
      return [
        {
          kind: "sendList",
          body: ctx.t("commerce_orders_body"),
          buttonText: ctx.t("commerce_orders_button"),
          sections: [
            {
              rows: orders.map((o) => ({
                id: `${ID.order}${o.id}`,
                title: o.id,
                description: `${findBrand(dataset, o.brandId)?.name ?? ""} · ${formatRupees(o.price.total)} · ${statusLabel(ctx, o.status)}`,
              })),
            },
          ],
        },
      ];
    },
  }),

  [ORDER_STATUS]: state(ORDER_STATUS, {
    onEnter: (ctx) => {
      const order = ownedOrder(ctx);
      if (!order) return notFound(ctx);
      const done = (k: CopyKey) => `✅ ${ctx.t(k)}`;
      const todo = (k: CopyKey) => `▫️ ${ctx.t(k)}`;
      const bad = (k: CopyKey) => `❌ ${ctx.t(k)}`;
      const steps: Record<OrderStatus, string[]> = {
        pending_payment: [done("commerce_step_placed"), todo("commerce_step_paid"), todo("commerce_step_delivered")],
        processing: [done("commerce_step_placed"), done("commerce_step_paid"), todo("commerce_step_delivered")],
        delivered: [done("commerce_step_placed"), done("commerce_step_paid"), done("commerce_step_delivered")],
        cancelled: [done("commerce_step_placed"), bad("commerce_step_cancelled")],
        failed: [done("commerce_step_placed"), bad("commerce_step_failed")],
      };
      const codes = order.status === "delivered" ? `\n\n${ctx.t("commerce_codes_label")}\n${monospace(order.codes)}` : "";
      return [
        {
          kind: "sendText",
          text:
            ctx.t("commerce_order_status", {
              order: order.id,
              brand: findBrand(dataset, order.brandId)?.name ?? "",
              total: formatRupees(order.price.total),
              steps: steps[order.status].join("\n"),
            }) + codes,
        },
        menuButtons(ctx, ctx.t("commerce_next_body")),
      ];
    },
  }),

  // J5
  [BALANCE]: state(BALANCE, {
    onEnter: (ctx) => [
      menuButtons(ctx, ctx.t("commerce_balance_body", { points: points(pointsLedger.available(ctx.session.userId)) })),
    ],
  }),
};

/**
 * Global commerce routes, checked by the engine from any state:
 * prefixed button/row ids, and a completed commerce Flow (nfm_reply whose
 * flow_token is ours). Returns null for anything else.
 */
export function routeCommerceInput(ctx: FlowContext): string | null {
  const { message } = ctx;

  if (message.type === "flow_reply") {
    if (!sessionIdFromToken(message.flowResponse?.flow_token)) return null; // not the commerce Flow
    const ref = message.flowResponse?.order_ref;
    cdata(ctx).orderId = typeof ref === "string" ? ref : undefined;
    return SUMMARY; // ownership is checked there
  }

  if (message.type === "order" && message.order) {
    if (!catalogOn()) return null;
    cdata(ctx).cart = message.order;
    return CART;
  }

  const id = message.replyId;
  if (!id) return null;
  if (id === ID.buy) return BUY;
  if (catalogOn()) {
    if (id === ID.catalog) return CATALOG;
    if (id === ID.other) return OTHER_AMOUNT;
    if (id.startsWith(ID.product) && id.length > ID.product.length) {
      cdata(ctx).brandId = id.slice(ID.product.length);
      return PRODUCT;
    }
  }
  if (id === ID.track) return TRACK;
  if (id === ID.balance) return BALANCE;

  const routes: [string, string, keyof CommerceData][] = [
    [ID.view, BRAND, "brandId"],
    [ID.pay, PAY, "orderId"],
    [ID.cancel, CANCEL, "orderId"],
    [ID.order, ORDER_STATUS, "orderId"],
  ];
  for (const [prefix, next, field] of routes) {
    if (id.startsWith(prefix) && id.length > prefix.length) {
      const c = cdata(ctx);
      (c as Record<string, unknown>)[field] = id.slice(prefix.length);
      if (next === PAY) c.otpError = false;
      return next;
    }
  }
  return null;
}

/** Demo messages the setup scripts can trigger (via the bot's /internal/demo/send). */
export type DemoSendKind = "flow" | "carousel" | "catalog";

/**
 * Sends one demo entry message to `to`, built by the same states the chat
 * uses, through the guarded demo client. Runs inside the bot process so a
 * Flow's session lives where the Flow endpoint can find it.
 */
export async function sendDemoMessage(
  to: string,
  kind: DemoSendKind,
  opts: { brandId?: string; screen?: "ITEM" | "OTHER_AMOUNT"; mode?: "draft" | "published" } = {},
): Promise<{ sent: string[] }> {
  const ctx: FlowContext = {
    session: { userId: to, currentStateKey: COMMERCE_MENU_STATE_KEY, data: {}, lastInboundAt: new Date(), updatedAt: new Date() },
    message: { from: to, messageId: "script", type: "other", timestamp: "0" },
    t: (key, vars) => resolveCopy("en", key, vars),
  };
  let actions: OutgoingAction[];
  if (kind === "flow") {
    const screen = opts.screen ?? "ITEM";
    const brand = findBrand(dataset, opts.brandId ?? dataset.brands[0]!.id);
    if (screen === "ITEM" && !brand) throw new Error(`unknown brand ${opts.brandId}`);
    actions = flowMessage(
      ctx,
      screen,
      screen === "ITEM" ? ctx.t("commerce_brand_body", { brand: brand!.name, item: brand!.itemName }) : ctx.t("commerce_other_amount_body"),
      screen === "ITEM" ? brand!.id : undefined,
      opts.mode,
    );
  } else if (kind === "carousel") {
    actions = await commerceStates[BUY]!.onEnter(ctx);
  } else {
    if (!catalogOn()) throw new Error("catalog path is off: set COMMERCE_CATALOG_ENABLED=true and COMMERCE_CATALOG_ID");
    actions = await commerceStates[CATALOG]!.onEnter(ctx);
  }
  const sent: string[] = [];
  for (const action of actions) {
    sent.push((await executeAction(demoWhatsAppClient, to, action)) ?? action.kind);
  }
  return { sent };
}
