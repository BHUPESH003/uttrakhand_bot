/**
 * Shared PrismaClient singleton. Import this (not `new PrismaClient()`)
 * everywhere else in this package and in consumers — one connection pool
 * per process.
 */
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy packages/db/.env.example to packages/db/.env " +
      "(and make sure the consuming app's .env has it too) — see docker-compose.yml at the repo root for local Postgres.",
  );
}

export const prisma = new PrismaClient();

/**
 * Trivial round-trip query, exported so a long-running consumer (apps/bot)
 * can call it on an interval to stop a serverless Postgres (e.g. Neon's
 * free tier, which auto-suspends its compute after ~5 minutes idle) from
 * ever going cold — the next real query would otherwise pay that wake-up
 * latency. Not needed against an always-on Postgres.
 */
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
