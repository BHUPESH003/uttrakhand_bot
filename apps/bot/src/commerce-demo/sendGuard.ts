/**
 * Safety gate for every message the commerce demo sends: blocked unless
 * DEMO_SEND_ENABLED=true AND the recipient is in DEMO_ALLOWED_RECIPIENTS.
 *
 * Enforced inside WhatsAppClient (its sendGuard hook runs before the
 * network call), on a dedicated client instance — so the demo can't send
 * around it, and the certificate service's default client is untouched.
 */
import { config } from "../config";
import { maskPhone, WhatsAppClient, type SendGuard } from "../whatsapp/client";

export class DemoSendBlockedError extends Error {
  constructor(
    public readonly reason: "disabled" | "not_allowlisted",
    to: string,
  ) {
    super(
      reason === "disabled"
        ? `demo send to ${maskPhone(to)} blocked: DEMO_SEND_ENABLED is not "true"`
        : `demo send to ${maskPhone(to)} blocked: recipient not in DEMO_ALLOWED_RECIPIENTS`,
    );
    this.name = "DemoSendBlockedError";
  }
}

export function createDemoSendGuard(settings: { enabled: boolean; allowedRecipients: string[] }): SendGuard {
  const allowed = new Set(settings.allowedRecipients);
  return (to) => {
    if (!settings.enabled) throw new DemoSendBlockedError("disabled", to);
    if (!allowed.has(to)) throw new DemoSendBlockedError("not_allowlisted", to);
  };
}

/** True when the guard would let a demo message to `to` through — used to show the demo menu entry only to those numbers. */
export function isDemoRecipient(to: string): boolean {
  return config.DEMO_SEND_ENABLED && config.DEMO_ALLOWED_RECIPIENTS.includes(to);
}

export const demoSendGuard = createDemoSendGuard({
  enabled: config.DEMO_SEND_ENABLED,
  allowedRecipients: config.DEMO_ALLOWED_RECIPIENTS,
});

/** The only client the commerce demo may use. */
export const demoWhatsAppClient = new WhatsAppClient({ sendGuard: demoSendGuard });
