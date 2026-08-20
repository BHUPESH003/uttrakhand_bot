/**
 * Tells apps/bot an application was approved. All WhatsApp logic (the 24h
 * window check, the actual sends, the audit log) lives in the bot service —
 * this is just the HTTP call across.
 */
import { config } from "../config";

export interface NotifyResult {
  status: "sent" | "outside_window" | "error";
  message?: string;
}

export async function notifyApproved(applicationId: string): Promise<NotifyResult> {
  try {
    const res = await fetch(`${config.BOT_INTERNAL_URL}/internal/notify-approved`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": config.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ applicationId }),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; error?: string };

    if (!res.ok) {
      return { status: "error", message: body.error ?? `Bot service returned ${res.status}` };
    }
    return { status: (body.status as NotifyResult["status"]) ?? "sent", message: body.message };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to reach the bot service",
    };
  }
}
