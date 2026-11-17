/**
 * Admin-controlled Flow flags ("which screens appear"), stored as JSON in
 * the git-ignored demo data folder and cached in memory.
 *
 *   offersScreen  false -> the endpoint skips OFFERS (ITEM/amount -> REVIEW)
 *   promoField    false -> promo code field hidden on OFFERS
 *   customAmount  false -> no "Other amount" on ITEM, nor next to the catalog
 *   maxQty        quantity choices 1..maxQty (also caps cart lines)
 *
 * A Flow session takes a snapshot when it starts (sessions.ts), so changing
 * a flag never changes screens halfway through someone's Flow.
 *
 * Writers: `pnpm demo:config` and the admin page (via the bot's
 * /internal/demo-config). The cache re-reads the file when its mtime
 * changes, so a write by either is picked up without a restart.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { config } from "../config";
import { MAX_QUANTITY } from "./data/rules";

export const flowConfigSchema = z
  .object({
    offersScreen: z.boolean(),
    promoField: z.boolean(),
    customAmount: z.boolean(),
    // Flow Dropdown allows up to 200 options; 20 keeps the picker usable.
    // Below 9 the demo failure triggers (qty 7 / 9) can't be picked.
    maxQty: z.number().int().min(1).max(20),
  })
  .strict();

export type FlowConfig = z.infer<typeof flowConfigSchema>;

export const DEFAULT_FLOW_CONFIG: FlowConfig = { offersScreen: true, promoField: true, customAmount: true, maxQty: MAX_QUANTITY };

/** apps/bot/.demo-data unless DEMO_DATA_DIR is set (works from src/ under tsx and dist/ after build). */
export const DEMO_DATA_DIR = resolve(config.DEMO_DATA_DIR ?? join(__dirname, "..", "..", ".demo-data"));

export class FlowConfigStore {
  private cache: { mtimeMs: number; value: FlowConfig } | null = null;

  constructor(readonly path: string) {}

  /** Current flags. Missing file -> defaults; unreadable/invalid file -> defaults + a warning. */
  get(): FlowConfig {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.path).mtimeMs;
    } catch {
      return { ...DEFAULT_FLOW_CONFIG };
    }
    if (this.cache?.mtimeMs === mtimeMs) return { ...this.cache.value };
    try {
      const value = flowConfigSchema.parse({ ...DEFAULT_FLOW_CONFIG, ...JSON.parse(readFileSync(this.path, "utf-8")) });
      this.cache = { mtimeMs, value };
      return { ...value };
    } catch (err) {
      console.warn(`[demo-config] ${this.path} is invalid, using defaults:`, err instanceof Error ? err.message : err);
      return { ...DEFAULT_FLOW_CONFIG };
    }
  }

  /** Merges, validates (throws ZodError on bad input) and writes atomically. Returns the saved flags. */
  set(patch: Partial<FlowConfig>): FlowConfig {
    const value = flowConfigSchema.parse({ ...this.get(), ...patch });
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmp, this.path);
    this.cache = null; // re-read (and re-stat) on next get
    return { ...value };
  }
}

export const flowConfig = new FlowConfigStore(join(DEMO_DATA_DIR, "flow-config.json"));
