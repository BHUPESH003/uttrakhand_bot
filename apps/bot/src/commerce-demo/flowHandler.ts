/**
 * Business side of the commerce-demo Flow endpoint: takes a DECRYPTED
 * request, returns the response to encrypt (or a 427). No crypto, no HTTP —
 * routes/flowEndpoint.ts does transport. Screen shapes must match
 * flows/commerce-demo.flow.json (flowEndpoint.test.ts checks that).
 *
 * Two ways in:
 *   ITEM          brand already chosen (carousel card): presets or "Other amount"
 *   OTHER_AMOUNT  catalog path's "Other amount" button: pick the brand AND type
 *                 an amount on one screen. A separate entry screen (no inbound
 *                 edge) because `navigate` may only open entry screens.
 */
import type { FlowConfig } from "./config";
import { findBrand, type Brand, type Dataset } from "./data/catalog";
import { newDemoOrder, type OrderStore } from "./data/orders";
import {
  amountRangeText,
  formatRupees,
  offersForBrand,
  priceOrder,
  PROMOS,
  validateAmount,
  validatePromo,
} from "./data/rules";
import { sessionIdFromToken, type CommerceScreen, type CommerceSession, type CommerceSessionStore } from "./sessions";

export const CUSTOM_AMOUNT_ID = "custom";
const NO_OFFER_ID = "none";

export type NextScreen = CommerceScreen | "SUCCESS";

/**
 * Forward routing, decided by the server. Every edge this can return must
 * be in the Flow JSON routing_model (checked in tests).
 */
export function nextScreen(from: CommerceScreen, selections: { amountChoice?: string }, options: Pick<FlowConfig, "offersScreen">): NextScreen {
  const afterAmount: CommerceScreen = options.offersScreen ? "OFFERS" : "REVIEW";
  switch (from) {
    case "ITEM":
      return selections.amountChoice === CUSTOM_AMOUNT_ID ? "CUSTOM_AMOUNT" : afterAmount;
    case "CUSTOM_AMOUNT":
    case "OTHER_AMOUNT":
      return afterAmount;
    case "OFFERS":
      return "REVIEW";
    case "REVIEW":
      return "SUCCESS";
  }
}

// ---------- request / response ----------

export interface FlowRequest {
  version?: string;
  action?: string;
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
}

export type FlowHandlerResult =
  | { status: 200; body: Record<string, unknown>; screen?: string }
  | { status: 427; body: { error_msg: string } };

/** Flags come from each session's snapshot (session.options), not from here. */
export interface FlowDeps {
  sessions: CommerceSessionStore;
  dataset: Dataset;
  orders: OrderStore;
}

const SCREENS = new Set<string>(["ITEM", "CUSTOM_AMOUNT", "OTHER_AMOUNT", "OFFERS", "REVIEW"]);
const isScreen = (s: unknown): s is CommerceScreen => typeof s === "string" && SCREENS.has(s);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const expired = (): FlowHandlerResult => ({
  status: 427,
  body: { error_msg: "This order session has expired. Please start again from the chat." },
});

/**
 * Screen data for `screen`, built from the session + data module. Also used
 * by journeys.ts to open the Flow on ITEM / OTHER_AMOUNT with its data.
 * Every screen except OTHER_AMOUNT needs session.brandId.
 */
export function screenData(screen: CommerceScreen, session: CommerceSession, dataset: Dataset) {
  const options = session.options;
  if (screen === "OTHER_AMOUNT") {
    return {
      brands: dataset.brands.map((b) => ({ id: b.id, title: b.name, description: amountRangeText(b) })),
      helper_text: "Must fit the range of the brand you chose",
    };
  }
  const brand = findBrand(dataset, session.brandId ?? "");
  if (!brand) throw new Error(`screen ${screen} needs a brand`);
  switch (screen) {
    case "ITEM":
      return {
        brand_name: brand.name,
        item_name: brand.itemName,
        presets: [
          ...brand.presetAmounts.map((a) => ({ id: String(a), title: formatRupees(a) })),
          ...(options.customAmount ? [{ id: CUSTOM_AMOUNT_ID, title: "Other amount" }] : []),
        ],
        quantities: Array.from({ length: options.maxQty }, (_, i) => ({ id: String(i + 1), title: String(i + 1) })),
      };
    case "CUSTOM_AMOUNT":
      return { brand_name: brand.name, helper_text: amountRangeText(brand) };
    case "OFFERS": {
      const subtotal = (session.amount ?? 0) * (session.qty ?? 1);
      return {
        offers: [
          { id: NO_OFFER_ID, title: "No offer", description: "Continue without an offer", enabled: true },
          ...offersForBrand(brand, subtotal).map((o) => ({
            id: o.promo.code,
            title: o.promo.code,
            description: o.eligible
              ? o.promo.description
              : `${o.promo.description}. Add ${formatRupees(o.shortfall)} more to unlock`,
            enabled: o.eligible,
          })),
        ],
        show_promo: options.promoField,
      };
    }
    case "REVIEW": {
      const promo = PROMOS.find((p) => p.code === session.promoCode) ?? null;
      const price = priceOrder(session.amount!, session.qty!, promo, "online", 0);
      return {
        brand_line: `Brand: ${brand.name}`,
        amount_line: `Amount: ${formatRupees(session.amount!)} each`,
        quantity_line: `Quantity: ${session.qty}`,
        offer_line: promo ? `Offer: ${promo.code} (-${formatRupees(price.discount)})` : "Offer: none",
        total_line: `Total: ${formatRupees(price.total)}`,
      };
    }
  }
}

function show(screen: CommerceScreen, session: CommerceSession, deps: FlowDeps, errorMessage?: string): FlowHandlerResult {
  // No brand yet (opened on OTHER_AMOUNT): that's the only screen we can render.
  const target = session.brandId ? screen : "OTHER_AMOUNT";
  const data: Record<string, unknown> = screenData(target, session, deps.dataset);
  if (errorMessage) data.error_message = errorMessage;
  return { status: 200, screen: target, body: { screen: target, data } };
}

/** Sets amount (+ qty 1 when not chosen yet) after validating against the brand's min/max/step. */
function applyCustomAmount(session: CommerceSession, brand: Brand, raw: string): string | null {
  const amount = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const check = validateAmount(brand, amount);
  if (!check.ok) return check.message;
  session.amountChoice = CUSTOM_AMOUNT_ID;
  session.amount = amount;
  session.qty ??= 1; // no ITEM step on these paths
  return null;
}

/** Applies one screen's submitted form. Returns an error message to re-show that screen with, or null. */
function applySubmission(screen: CommerceScreen, data: Record<string, unknown>, session: CommerceSession, deps: FlowDeps): string | null {
  if (screen === "OTHER_AMOUNT") {
    const brand = findBrand(deps.dataset, str(data.brand));
    if (!brand) return "Choose a brand";
    const error = applyCustomAmount(session, brand, str(data.custom_amount));
    if (!error) session.brandId = brand.id;
    return error;
  }
  const brand = findBrand(deps.dataset, session.brandId ?? "")!;
  switch (screen) {
    case "ITEM": {
      const choice = str(data.amount);
      const qty = Number(str(data.quantity));
      const { maxQty, customAmount } = session.options;
      if (!Number.isInteger(qty) || qty < 1 || qty > maxQty) return `Choose a quantity from 1 to ${maxQty}`;
      const isPreset = brand.presetAmounts.includes(Number(choice));
      if (!isPreset && !(choice === CUSTOM_AMOUNT_ID && customAmount)) return "Choose an amount";
      session.amountChoice = choice;
      session.qty = qty;
      if (choice !== CUSTOM_AMOUNT_ID) session.amount = Number(choice);
      return null;
    }
    case "CUSTOM_AMOUNT":
      return applyCustomAmount(session, brand, str(data.custom_amount));
    case "OFFERS": {
      const subtotal = session.amount! * session.qty!;
      const typed = session.options.promoField ? str(data.promo_code) : "";
      const chosen = str(data.offer);
      const code = typed || (chosen && chosen !== NO_OFFER_ID ? chosen : "");
      if (!code) {
        session.promoCode = null;
        return null;
      }
      const check = validatePromo(code, brand, subtotal);
      if (!check.ok) return check.message;
      session.promoCode = check.promo.code;
      return null;
    }
    case "REVIEW":
      return null;
  }
}

export function handleFlowRequest(req: FlowRequest, deps: FlowDeps): FlowHandlerResult {
  if (req.action === "ping") return { status: 200, body: { data: { status: "active" } } };

  // Meta reporting that a response of ours was invalid — acknowledge it,
  // even if the session has since ended.
  if (req.data && typeof req.data.error === "string") {
    console.warn(`[flow] client error notification on ${req.screen ?? "-"}: ${req.data.error} ${str(req.data.error_message)}`);
    return { status: 200, body: { data: { acknowledged: true } } };
  }

  const sessionId = sessionIdFromToken(req.flow_token);
  const session = sessionId ? deps.sessions.get(sessionId) : undefined;
  if (!session) return expired();
  if (session.brandId && !findBrand(deps.dataset, session.brandId)) return expired();

  deps.sessions.save(session); // refresh TTL on every hit

  if (req.action === "INIT") return show(session.startScreen, session, deps);
  if (req.action === "BACK") return show(isScreen(req.screen) ? req.screen : session.startScreen, session, deps);
  if (req.action !== "data_exchange" || !isScreen(req.screen)) return show(session.startScreen, session, deps);

  // A brand-dependent screen submitted before any brand was chosen: re-show the brand picker.
  const screen: CommerceScreen = session.brandId ? req.screen : "OTHER_AMOUNT";
  const error = applySubmission(screen, req.data ?? {}, session, deps);
  if (error) return show(screen, session, deps, error);

  const next = nextScreen(screen, session, session.options);
  if (next !== "SUCCESS") return show(next, session, deps);

  const promo = PROMOS.find((p) => p.code === session.promoCode) ?? null;
  const order = deps.orders.create(
    newDemoOrder({ userId: session.userId, brandId: session.brandId!, amount: session.amount!, qty: session.qty!, promo }),
  );
  deps.sessions.delete(session.id); // token is single-use from here: any replay gets 427
  return {
    status: 200,
    screen: "SUCCESS",
    body: {
      screen: "SUCCESS",
      data: { extension_message_response: { params: { flow_token: req.flow_token, order_ref: order.id } } },
    },
  };
}
