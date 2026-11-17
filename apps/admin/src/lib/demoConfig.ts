/**
 * Commerce-demo Flow flags ("which screens appear"), owned by apps/bot —
 * see apps/bot/src/commerce-demo/config.ts. Admin only relays reads/writes
 * to the bot's internal API (same shared secret as notifyBot.ts), so the
 * bot stays the single writer of its flags file and cache.
 */
import { config } from "../config";

export interface DemoFlowConfig {
  offersScreen: boolean;
  promoField: boolean;
  customAmount: boolean;
  maxQty: number;
}

export type DemoConfigResult = { ok: true; config: DemoFlowConfig } | { ok: false; status: number; error: string };

async function callBot(method: "GET" | "PUT", body?: unknown): Promise<DemoConfigResult> {
  try {
    const res = await fetch(`${config.BOT_INTERNAL_URL}/internal/demo-config`, {
      method,
      headers: { "Content-Type": "application/json", "x-internal-secret": config.INTERNAL_API_SECRET },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { config?: DemoFlowConfig; error?: string };
    if (!res.ok || !json.config) return { ok: false, status: res.status, error: json.error ?? `Bot service returned ${res.status}` };
    return { ok: true, config: json.config };
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : "Failed to reach the bot service" };
  }
}

export const getDemoConfig = () => callBot("GET");
/** The bot validates (types, maxQty 1-20, no unknown keys) and returns 400 with the reason. */
export const putDemoConfig = (patch: Partial<DemoFlowConfig>) => callBot("PUT", patch);
