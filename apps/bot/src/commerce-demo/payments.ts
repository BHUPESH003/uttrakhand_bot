/**
 * Payments for the commerce demo, behind an interface so a real provider
 * (e.g. WhatsApp Pay via sendOrderDetails, or a PG) can replace the demo
 * one without touching the journeys. Payments know nothing about orders
 * beyond the id/user/amounts they are given — marking an order paid and
 * issuing codes is the journey's job.
 *
 * DemoPaymentProvider: no real money. Points (from the demo ledger) are
 * held on initiate and need the fixed demo OTP to confirm; the online part
 * is treated as paid instantly.
 */
import { randomUUID } from "node:crypto";
import type { PointsLedger } from "./data/points";

export interface PaymentIntent {
  id: string;
  orderId: string;
  userId: string;
  pointsUsed: number;
  onlineDue: number;
  requiresOtp: boolean;
  status: "pending" | "confirmed" | "refunded";
}

export type ConfirmResult =
  | { ok: true; intent: PaymentIntent; duplicate: boolean }
  | { ok: false; reason: "unknown" | "wrong_otp" | "not_pending" };

export interface PaymentProvider {
  /** Idempotent per order: a pending intent for the same order is returned as-is. */
  initiate(order: { id: string; userId: string }, amounts: { pointsUsed: number; onlineDue: number }): Promise<PaymentIntent>;
  /** A repeat confirm of a confirmed intent is ok with duplicate: true (duplicate payment events). */
  confirm(intentId: string, otp?: string): Promise<ConfirmResult>;
  /** Pending -> releases held points; confirmed -> gives points back. False if nothing to refund. */
  refund(intentId: string): Promise<boolean>;
  get(intentId: string): PaymentIntent | undefined;
}

export const DEMO_OTP = "123456";

// ponytail: intents in process memory, like the rest of the demo data.
export class DemoPaymentProvider implements PaymentProvider {
  private readonly intents = new Map<string, PaymentIntent & { holdId: string | null }>();

  constructor(private readonly ledger: PointsLedger) {}

  async initiate(order: { id: string; userId: string }, amounts: { pointsUsed: number; onlineDue: number }) {
    for (const existing of this.intents.values()) {
      if (existing.orderId === order.id && existing.status === "pending") return existing;
    }
    const holdId = amounts.pointsUsed > 0 ? this.ledger.hold(order.userId, amounts.pointsUsed) : null;
    const intent = {
      id: `PAY-${randomUUID()}`,
      orderId: order.id,
      userId: order.userId,
      pointsUsed: amounts.pointsUsed,
      onlineDue: amounts.onlineDue,
      requiresOtp: amounts.pointsUsed > 0,
      status: "pending" as const,
      holdId,
    };
    this.intents.set(intent.id, intent);
    return intent;
  }

  async confirm(intentId: string, otp?: string): Promise<ConfirmResult> {
    const intent = this.intents.get(intentId);
    if (!intent) return { ok: false, reason: "unknown" };
    if (intent.status === "confirmed") return { ok: true, intent, duplicate: true };
    if (intent.status !== "pending") return { ok: false, reason: "not_pending" };
    if (intent.requiresOtp && otp?.trim() !== DEMO_OTP) return { ok: false, reason: "wrong_otp" };
    if (intent.holdId) this.ledger.capture(intent.holdId);
    intent.status = "confirmed";
    return { ok: true, intent, duplicate: false };
  }

  async refund(intentId: string): Promise<boolean> {
    const intent = this.intents.get(intentId);
    if (!intent) return false;
    if (intent.status === "pending") {
      if (intent.holdId) this.ledger.release(intent.holdId);
    } else if (intent.status === "confirmed") {
      if (intent.pointsUsed > 0) this.ledger.credit(intent.userId, intent.pointsUsed);
    } else {
      return false;
    }
    intent.status = "refunded";
    return true;
  }

  get(intentId: string): PaymentIntent | undefined {
    return this.intents.get(intentId);
  }
}
