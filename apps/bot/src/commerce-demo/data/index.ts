/**
 * The commerce demo's single source of fake data and business rules.
 * Everything else in commerce-demo/ imports from here, so swapping in real
 * APIs later means changing this folder only.
 *
 *   catalog.ts — brands, per DEMO_DATASET (neutral | voucher)
 *   rules.ts   — validateAmount, validatePromo, offersForBrand, priceOrder (pure)
 *   points.ts  — demo points ledger: hold / capture / release
 *   orders.ts  — demo order store + DEMO FAILURE TRIGGERS (qty 7, qty 9)
 *   products.ts — catalog products (retailer ids "demo-a-500"), CSV feed, product-list sections
 */
import { config } from "../../config";
import { getDataset } from "./catalog";
import { OrderStore } from "./orders";
import { PointsLedger } from "./points";

export const dataset = getDataset(config.DEMO_DATASET);
export const pointsLedger = new PointsLedger();
export const orderStore = new OrderStore(dataset.codePrefix);

export * from "./catalog";
export * from "./rules";
export * from "./points";
export * from "./orders";
export * from "./products";
