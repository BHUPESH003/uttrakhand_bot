/**
 * Correlates a message WE sent (by its wamid) with Meta's later, asynchronous
 * delivery-status webhook callback — see routes/webhook.ts, which feeds every
 * status event here, and flow/aiChat.ts, which waits on this before sending
 * whatever comes after a voice reply. A 200 on the send POST only means Meta
 * *queued* the message; for audio specifically, Meta still has to fetch and
 * process our URL before it reaches the device, which measurably lags a
 * lightweight text/button message sent right after — a fixed delay guessed
 * at that gap and wasn't reliable, this waits for the real signal instead.
 *
 * In-memory only: fine for a single long-lived bot process. A waiter still
 * pending when the process restarts just times out for whoever's waiting,
 * same as it would if Meta's webhook was simply slow.
 */
interface PendingWait {
  resolve: () => void;
  timeout: NodeJS.Timeout;
}

const pending = new Map<string, PendingWait>();

// Statuses that mean "stop waiting" — "sent" is just Meta's own server
// accepting the message, not it reaching the device, so it doesn't count.
const TERMINAL_STATUSES = new Set(["delivered", "read", "failed"]);

/**
 * Resolves once Meta reports `delivered` (or `read`/`failed`) for `wamid`,
 * or after `timeoutMs` — whichever comes first. Never rejects: a timeout is
 * a fallback to proceed anyway, not a failure the caller needs to handle.
 */
export function waitForDelivery(wamid: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => {
      clearTimeout(timeout);
      pending.delete(wamid);
      resolve();
    };
    const timeout = setTimeout(settle, timeoutMs);
    pending.set(wamid, { resolve: settle, timeout });
  });
}

/** Called from the webhook for every status event Meta sends us. */
export function recordStatus(wamid: string, status: string): void {
  if (!TERMINAL_STATUSES.has(status)) return;
  pending.get(wamid)?.resolve();
}
