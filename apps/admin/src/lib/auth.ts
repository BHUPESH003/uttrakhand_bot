/**
 * Demo-only auth: a single shared password (ADMIN_PASSWORD) compared
 * directly against a plaintext cookie value. No hashing, no per-user
 * accounts, no CSRF token, no session store. Good enough to keep the
 * dashboard out of casual reach for a demo — do not carry this pattern
 * into anything real.
 */
import { cookies } from "next/headers";
import { config } from "../config";

export const AUTH_COOKIE = "admin_auth";

export function isAuthed(cookieValue: string | undefined): boolean {
  return Boolean(cookieValue) && cookieValue === config.ADMIN_PASSWORD;
}

/** Backstop for Server Actions — proxy.ts already gates the page routes, but Server Functions are reachable directly via POST. */
export async function requireAuth(): Promise<void> {
  const store = await cookies();
  if (!isAuthed(store.get(AUTH_COOKIE)?.value)) {
    throw new Error("Unauthorized");
  }
}
