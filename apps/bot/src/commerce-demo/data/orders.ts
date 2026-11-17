/**
 * Demo orders, in memory.
 *
 *   create()   -> pending_payment
 *   markPaid() -> processing        (idempotent: a repeat returns duplicate: true, no change)
 *   fulfil()   -> delivered + codes (or failed, see triggers below; idempotent once delivered)
 *   cancel()   -> cancelled         (only from pending_payment)
 *   fail()     -> failed            (from pending_payment or processing)
 *
 * DEMO FAILURE TRIGGERS (choose the quantity in the demo to force these):
 *   qty 7 — payment succeeds, then issuance fails: fulfil() marks the order
 *           failed ("issuance_failed") and issues no codes.
 *   qty 9 — for duplicate payment event testing: the payment simulator
 *           should deliver its success event twice; markPaid()/fulfil()
 *           must absorb the repeat (no second set of codes).
 *
 * ponytail: process memory, lost on restart; swap for the real order API later.
 */
import { randomInt } from "node:crypto";
import { priceOrder, type PriceBreakdown, type Promo } from "./rules";

export type OrderStatus = "pending_payment" | "processing" | "delivered" | "cancelled" | "failed";

export const DEMO_FAILURE_TRIGGERS = {
  issuanceFailsQty: 7,
  duplicateEventQty: 9,
} as const;

export interface Order {
  id: string;
  userId: string;
  brandId: string;
  amount: number;
  qty: number;
  promoCode: string | null;
  price: PriceBreakdown;
  pointsHoldId: string | null;
  status: OrderStatus;
  /** Demo codes, one per unit — filled on delivery. */
  codes: string[];
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewOrder = Pick<Order, "userId" | "brandId" | "amount" | "qty" | "promoCode" | "price" | "pointsHoldId">;

/**
 * The one way every demo order is built — Flow preset, Flow custom amount
 * and catalog cart alike. Priced from brand + amount + qty (+ promo) only,
 * so an order never needs a catalog product, and payment has one code path.
 */
export function newDemoOrder(input: { userId: string; brandId: string; amount: number; qty: number; promo: Promo | null }): NewOrder {
  return {
    userId: input.userId,
    brandId: input.brandId,
    amount: input.amount,
    qty: input.qty,
    promoCode: input.promo?.code ?? null,
    price: priceOrder(input.amount, input.qty, input.promo, "online", 0),
    pointsHoldId: null,
  };
}

// No 0/O/1/I — codes get read aloud and typed.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET.charAt(randomInt(ALPHABET.length));
  return out;
}

export class OrderStore {
  private readonly orders = new Map<string, Order>();

  constructor(private readonly codePrefix: string) {}

  create(input: NewOrder): Order {
    const now = new Date();
    const order: Order = {
      ...input,
      id: `ORD-${randomCode(8)}`,
      status: "pending_payment",
      codes: [],
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.id, order);
    return order;
  }

  get(id: string): Order | undefined {
    return this.orders.get(id);
  }

  listForUser(userId: string): Order[] {
    return [...this.orders.values()].filter((o) => o.userId === userId);
  }

  markPaid(id: string): { order: Order; duplicate: boolean } {
    const order = this.require(id);
    if (order.status === "processing" || order.status === "delivered") return { order, duplicate: true };
    this.expect(order, "pending_payment", "mark paid");
    this.set(order, "processing");
    return { order, duplicate: false };
  }

  fulfil(id: string): Order {
    const order = this.require(id);
    if (order.status === "delivered") return order;
    this.expect(order, "processing", "fulfil");
    if (order.qty === DEMO_FAILURE_TRIGGERS.issuanceFailsQty) {
      this.set(order, "failed", "issuance_failed");
      return order;
    }
    order.codes = Array.from({ length: order.qty }, () => `${this.codePrefix}-${randomCode(4)}-${randomCode(4)}`);
    this.set(order, "delivered");
    return order;
  }

  cancel(id: string): Order {
    const order = this.require(id);
    this.expect(order, "pending_payment", "cancel");
    this.set(order, "cancelled");
    return order;
  }

  fail(id: string, reason: string): Order {
    const order = this.require(id);
    if (order.status !== "pending_payment" && order.status !== "processing") {
      throw new Error(`cannot fail order ${id} in status ${order.status}`);
    }
    this.set(order, "failed", reason);
    return order;
  }

  private require(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new Error(`unknown order ${id}`);
    return order;
  }

  private expect(order: Order, status: OrderStatus, action: string): void {
    if (order.status !== status) throw new Error(`cannot ${action} order ${order.id} in status ${order.status}`);
  }

  private set(order: Order, status: OrderStatus, failureReason: string | null = null): void {
    order.status = status;
    order.failureReason = failureReason;
    order.updatedAt = new Date();
  }
}
