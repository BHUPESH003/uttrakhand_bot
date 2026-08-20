import { resolveToken, type HandoffToken } from "db";

/** Resolves a handoff token and returns null if it doesn't exist or has expired — the one check both /apply and the submit API route need. */
export async function resolveValidToken(token: string): Promise<HandoffToken | null> {
  const row = await resolveToken(token);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}
