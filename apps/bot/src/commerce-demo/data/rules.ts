/**
 * Pure business rules: amount validation, promo codes, pricing. No state,
 * no I/O — everything here is a function of its arguments.
 *
 * All money is whole rupees (integers). 1 point = ₹1.
 *
 * Messages are English; the flow layer can map `reason` to copy.ts keys
 * for Hindi.
 */
import type { Brand, Category } from "./catalog";

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// ---------- amounts ----------

/** Quantity choices offered per order: 1..MAX_QUANTITY. */
export const MAX_QUANTITY = 10;

/** "Between ₹100 and ₹10,000 in steps of ₹50" — the custom-amount helper text. */
export function amountRangeText(brand: Brand): string {
  const { min, max, step } = brand.limits;
  return `Between ${formatRupees(min)} and ${formatRupees(max)} in steps of ${formatRupees(step)}`;
}

export type AmountCheck =
  | { ok: true }
  | { ok: false; reason: "not_integer" | "below_min" | "above_max" | "not_step"; message: string };

export function validateAmount(brand: Brand, amount: number): AmountCheck {
  const { min, max, step } = brand.limits;
  const reason = !Number.isInteger(amount)
    ? "not_integer"
    : amount < min
      ? "below_min"
      : amount > max
        ? "above_max"
        : amount % step !== 0
          ? "not_step"
          : null;
  if (!reason) return { ok: true };
  return {
    ok: false,
    reason,
    message: `Enter an amount ${amountRangeText(brand).toLowerCase()}`,
  };
}

// ---------- promos ----------

interface PromoBase {
  code: string;
  description: string;
  /** Subtotal must be at least this (0 = no minimum). */
  minOrder: number;
  /** Restrict to these brand ids / categories; omitted = any brand. */
  brandIds?: string[];
  categories?: Category[];
}
/** Percent promos always have a cap; flat promos never do. */
export type Promo =
  | (PromoBase & { kind: "percent"; percent: number; cap: number })
  | (PromoBase & { kind: "flat"; amount: number });

export const PROMOS: Promo[] = [
  { code: "WELCOME10", kind: "percent", percent: 10, cap: 100, minOrder: 0, brandIds: ["brand_a"], description: "10% off, up to ₹100 (Sample brand A only)" },
  { code: "GIFT50", kind: "flat", amount: 50, minOrder: 500, description: "Flat ₹50 off on orders of ₹500 or more" },
  { code: "TREAT5", kind: "percent", percent: 5, cap: 75, minOrder: 0, description: "5% off, up to ₹75" },
  { code: "TRAVEL15", kind: "percent", percent: 15, cap: 300, minOrder: 1000, categories: ["Travel"], description: "15% off travel, up to ₹300, on orders of ₹1,000 or more" },
];

function appliesToBrand(promo: Promo, brand: Brand): boolean {
  return (
    (!promo.brandIds || promo.brandIds.includes(brand.id)) &&
    (!promo.categories || promo.categories.includes(brand.category))
  );
}

/** Discount for `subtotal`, rounded down to whole rupees. 0 if the minimum order isn't met. */
export function promoDiscount(promo: Promo, subtotal: number): number {
  if (subtotal < promo.minOrder) return 0;
  return promo.kind === "percent"
    ? Math.min(Math.floor((subtotal * promo.percent) / 100), promo.cap)
    : Math.min(promo.amount, subtotal);
}

export type PromoCheck =
  | { ok: true; promo: Promo }
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "wrong_brand"; message: string }
  | { ok: false; reason: "min_not_met"; message: string; shortfall: number };

/** Case-insensitive. Checks, in order: code exists, applies to this brand, minimum order met. */
export function validatePromo(code: string, brand: Brand, subtotal: number): PromoCheck {
  const normalized = code.trim().toUpperCase();
  const promo = PROMOS.find((p) => p.code === normalized);
  if (!promo) {
    return { ok: false, reason: "invalid", message: `${normalized || "That"} is not a valid promo code` };
  }
  if (!appliesToBrand(promo, brand)) {
    return { ok: false, reason: "wrong_brand", message: `${promo.code} can't be used for ${brand.name}` };
  }
  if (subtotal < promo.minOrder) {
    const shortfall = promo.minOrder - subtotal;
    return {
      ok: false,
      reason: "min_not_met",
      shortfall,
      message: `Add ${formatRupees(shortfall)} more to use ${promo.code} (minimum order ${formatRupees(promo.minOrder)})`,
    };
  }
  return { ok: true, promo };
}

export interface Offer {
  promo: Promo;
  eligible: boolean;
  /** Rupees still needed to reach the minimum; 0 when eligible. */
  shortfall: number;
}

/** Every promo usable on this brand, flagged by whether `subtotal` meets its minimum. */
export function offersForBrand(brand: Brand, subtotal = 0): Offer[] {
  return PROMOS.filter((p) => appliesToBrand(p, brand)).map((promo) => {
    const shortfall = Math.max(0, promo.minOrder - subtotal);
    return { promo, eligible: shortfall === 0, shortfall };
  });
}

// ---------- pricing ----------

/**
 * "online": pay everything online, points untouched.
 * "split": use points first — all of them if the balance is below the
 * total, otherwise just enough to cover it (onlineDue then 0).
 */
export type PayMode = "online" | "split";

export interface PriceBreakdown {
  subtotal: number;
  discount: number;
  total: number;
  pointsUsed: number;
  onlineDue: number;
}

function assertWholeNumber(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, got ${value}`);
  }
}

/**
 * `promo` must already have passed validatePromo for this brand — this only
 * re-checks the minimum (via promoDiscount), not brand eligibility.
 * `points` is the user's available balance.
 */
export function priceOrder(
  amount: number,
  qty: number,
  promo: Promo | null,
  payMode: PayMode,
  points: number,
): PriceBreakdown {
  assertWholeNumber(amount, "amount", 1);
  assertWholeNumber(qty, "qty", 1);
  assertWholeNumber(points, "points", 0);

  const subtotal = amount * qty;
  const discount = promo ? promoDiscount(promo, subtotal) : 0;
  const total = subtotal - discount;
  const pointsUsed = payMode === "split" ? Math.min(points, total) : 0;
  return { subtotal, discount, total, pointsUsed, onlineDue: total - pointsUsed };
}
