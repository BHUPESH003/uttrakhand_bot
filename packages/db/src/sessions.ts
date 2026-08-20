/**
 * Raw CRUD over the Session table. apps/bot's SessionStore implementation
 * wraps these — this module doesn't know about the flow engine's
 * SessionStore interface, it just persists rows.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./client";

export interface SessionRecord {
  userId: string;
  currentStateKey: string;
  /** The flow's free-form data bag — callers shouldn't need to know Prisma's JSON typing to save a session. */
  data: unknown;
  lastInboundAt: Date;
}

export async function getSessionRecord(userId: string) {
  return prisma.session.findUnique({ where: { userId } });
}

export async function saveSessionRecord(session: SessionRecord) {
  const data = session.data as Prisma.InputJsonValue;
  return prisma.session.upsert({
    where: { userId: session.userId },
    create: { ...session, data },
    update: {
      currentStateKey: session.currentStateKey,
      data,
      lastInboundAt: session.lastInboundAt,
    },
  });
}

export async function deleteSessionRecord(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}
