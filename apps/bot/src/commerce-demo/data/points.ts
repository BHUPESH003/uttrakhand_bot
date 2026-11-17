/**
 * Demo loyalty points, in memory. Every recipient starts with
 * DEFAULT_POINTS_BALANCE. Spending is two-phase so a failed or abandoned
 * payment never loses points:
 *
 *   hold(user, n)  -> holdId   (reserves n; available drops, balance doesn't)
 *   capture(holdId)            (payment succeeded: balance drops by n)
 *   release(holdId)            (payment failed/cancelled: reservation gone)
 *
 * capture/release are idempotent — a second call (e.g. a duplicate payment
 * event) returns false and changes nothing.
 *
 * ponytail: process memory, lost on restart; swap for the real loyalty API later.
 */
import { randomUUID } from "node:crypto";

export const DEFAULT_POINTS_BALANCE = 2500;

export class PointsLedger {
  private readonly balances = new Map<string, number>();
  private readonly holds = new Map<string, { userId: string; points: number }>();

  balance(userId: string): number {
    return this.balances.get(userId) ?? DEFAULT_POINTS_BALANCE;
  }

  /** Balance minus everything currently on hold. */
  available(userId: string): number {
    let held = 0;
    for (const h of this.holds.values()) if (h.userId === userId) held += h.points;
    return this.balance(userId) - held;
  }

  hold(userId: string, points: number): string {
    if (!Number.isInteger(points) || points <= 0) {
      throw new RangeError(`points to hold must be a positive integer, got ${points}`);
    }
    if (points > this.available(userId)) {
      throw new Error(`insufficient points: ${points} requested, ${this.available(userId)} available`);
    }
    const holdId = randomUUID();
    this.holds.set(holdId, { userId, points });
    return holdId;
  }

  capture(holdId: string): boolean {
    const h = this.holds.get(holdId);
    if (!h) return false;
    this.balances.set(h.userId, this.balance(h.userId) - h.points);
    this.holds.delete(holdId);
    return true;
  }

  release(holdId: string): boolean {
    return this.holds.delete(holdId);
  }

  /** Gives points back (refund of an already-captured hold). */
  credit(userId: string, points: number): void {
    if (!Number.isInteger(points) || points <= 0) {
      throw new RangeError(`points to credit must be a positive integer, got ${points}`);
    }
    this.balances.set(userId, this.balance(userId) + points);
  }
}
