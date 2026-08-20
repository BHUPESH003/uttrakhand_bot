import { Prisma, type MessageDirection } from "@prisma/client";
import { prisma } from "./client";

export interface LogMessageInput {
  mobileNumber: string;
  direction: MessageDirection;
  type: string;
  status: string;
  /** Any JSON-serializable value — callers shouldn't need to know Prisma's JSON typing to log a message. */
  payload: unknown;
  waMessageId?: string | null;
}

export async function logMessage(input: LogMessageInput) {
  return prisma.messageLog.create({
    data: {
      ...input,
      payload: input.payload as Prisma.InputJsonValue,
      waMessageId: input.waMessageId ?? null,
    },
  });
}

/** Full conversation history for one number, oldest first — the admin dashboard's read-only transcript view. */
export async function listMessagesForNumber(mobileNumber: string) {
  return prisma.messageLog.findMany({
    where: { mobileNumber },
    orderBy: { createdAt: "asc" },
  });
}

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Mirrors the reference bot's WhatsAppSessionDetail 24h window: WhatsApp
 * only lets a business free-form message a user within 24h of their last
 * inbound message. Session.lastInboundAt (kept current on every inbound —
 * see engine.ts) is the primary source since it's a single indexed lookup;
 * falls back to the latest INCOMING MessageLog for a number with message
 * history but no session row.
 */
export async function isWithinWindow(mobileNumber: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { userId: mobileNumber },
    select: { lastInboundAt: true },
  });

  const lastInboundAt =
    session?.lastInboundAt ??
    (
      await prisma.messageLog.findFirst({
        where: { mobileNumber, direction: "INCOMING" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
    )?.createdAt;

  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
}
