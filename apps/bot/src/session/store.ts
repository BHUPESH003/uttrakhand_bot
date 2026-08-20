/**
 * Conversation state for one user, keyed by phone number (`userId`).
 *
 * `data` is a free-form bag (lang, applicant name, chosen service, form
 * token, ...) — the flow states decide what lives in it, this module just
 * stores it.
 */
import { getSessionRecord, saveSessionRecord, deleteSessionRecord } from "db";

export interface Session {
  userId: string;
  currentStateKey: string;
  data: Record<string, unknown>;
  lastInboundAt: Date;
  updatedAt: Date;
}

/**
 * Storage boundary for sessions. The engine only talks to this interface,
 * so which backend is behind `sessionStore` below is invisible to callers.
 */
export interface SessionStore {
  getSession(userId: string): Promise<Session | undefined>;
  saveSession(session: Session): Promise<void>;
  resetSession(userId: string): Promise<void>;
}

/** In-process fallback, exported for the self-check test (flow/engine.test.ts) so it doesn't need a live Postgres to verify flow logic. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();

  async getSession(userId: string): Promise<Session | undefined> {
    return this.sessions.get(userId);
  }

  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.userId, session);
  }

  async resetSession(userId: string): Promise<void> {
    this.sessions.delete(userId);
  }
}

class DbSessionStore implements SessionStore {
  async getSession(userId: string): Promise<Session | undefined> {
    const record = await getSessionRecord(userId);
    if (!record) return undefined;
    return {
      userId: record.userId,
      currentStateKey: record.currentStateKey,
      data: record.data as Record<string, unknown>,
      lastInboundAt: record.lastInboundAt,
      updatedAt: record.updatedAt,
    };
  }

  async saveSession(session: Session): Promise<void> {
    await saveSessionRecord(session);
  }

  async resetSession(userId: string): Promise<void> {
    await deleteSessionRecord(userId);
  }
}

// ponytail: single global connection-backed store — fine for one bot
// instance; nothing here changes if that stops being true, since callers
// only ever see the SessionStore interface.
export const sessionStore: SessionStore = new DbSessionStore();
