/**
 * One-line human-readable summary of a MessageLog row for the read-only
 * conversation view. `payload` shapes vary (IncomingMessage for INCOMING,
 * OutgoingAction for OUTGOING — see apps/bot/src/whatsapp/types.ts and
 * flow/types.ts) so this stays defensive rather than typed against either.
 */
export function summarizeMessage(type: string, payload: unknown): string {
  const p = payload as Record<string, unknown> | null;
  if (!p) return type;

  if (typeof p.text === "string") return p.text;
  if (typeof p.body === "string") return p.body;
  if (typeof p.replyTitle === "string") return p.replyTitle;
  if (typeof p.imageUrl === "string") return "[image]";
  if (typeof p.documentUrl === "string") return `[document] ${p.filename ?? ""}`.trim();
  if (typeof p.url === "string") return `[link] ${p.url}`;

  return type;
}
