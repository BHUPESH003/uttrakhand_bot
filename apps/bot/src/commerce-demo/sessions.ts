/**
 * Commerce-demo session: what one user picked inside one Flow. Keyed by a
 * random session id; the Flow token is `demo:{sessionId}` (the Flow
 * endpoint only ever sees the token, never the phone number).
 *
 * In memory with a TTL behind an interface — no Prisma migration. A
 * restart drops in-flight demo carts, which is fine for a demo.
 */
import { randomUUID } from "node:crypto";
import { config } from "../config";
import type { FlowConfig } from "./config";

export type CommerceScreen = "ITEM" | "CUSTOM_AMOUNT" | "OTHER_AMOUNT" | "OFFERS" | "REVIEW";

export interface CommerceSession {
  id: string;
  userId: string;
  /** Unset until chosen when the Flow opens on OTHER_AMOUNT (brand picked on that screen). */
  brandId?: string;
  /** Screen INIT opens on (default ITEM). */
  startScreen: CommerceScreen;
  /** Admin flags as they were when this session started — screens never change mid-Flow. */
  options: FlowConfig;
  amountChoice?: string;
  amount?: number;
  qty?: number;
  promoCode?: string | null;
  expiresAt: number;
}

export interface CommerceSessionStore {
  create(input: { userId: string; brandId?: string; startScreen?: CommerceScreen; options: FlowConfig }): CommerceSession;
  /** undefined when unknown or expired. */
  get(id: string): CommerceSession | undefined;
  /** Refreshes the TTL. */
  save(session: CommerceSession): void;
  delete(id: string): void;
}

// ponytail: lazy expiry on get(), no sweeper — add a setInterval sweep if demo traffic ever grows.
export class InMemoryCommerceSessionStore implements CommerceSessionStore {
  private readonly sessions = new Map<string, CommerceSession>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: { userId: string; brandId?: string; startScreen?: CommerceScreen; options: FlowConfig }): CommerceSession {
    const session: CommerceSession = {
      id: randomUUID(),
      userId: input.userId,
      brandId: input.brandId,
      startScreen: input.startScreen ?? "ITEM",
      options: { ...input.options },
      expiresAt: 0,
    };
    this.save(session);
    return session;
  }

  get(id: string): CommerceSession | undefined {
    const session = this.sessions.get(id);
    if (session && session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  save(session: CommerceSession): void {
    session.expiresAt = this.now() + this.ttlMs;
    this.sessions.set(session.id, session);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}

const TOKEN_PREFIX = "demo:";

export const flowTokenFor = (session: CommerceSession) => `${TOKEN_PREFIX}${session.id}`;

/** "demo:{id}" -> id; anything else -> null. */
export function sessionIdFromToken(token: unknown): string | null {
  return typeof token === "string" && token.startsWith(TOKEN_PREFIX) && token.length > TOKEN_PREFIX.length
    ? token.slice(TOKEN_PREFIX.length)
    : null;
}

export const commerceSessions: CommerceSessionStore = new InMemoryCommerceSessionStore(
  config.SESSION_IDLE_MINUTES * 60_000,
);
