"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "@/config";
import { AUTH_COOKIE } from "@/lib/auth";

export async function login(formData: FormData) {
  const password = formData.get("password");

  if (password !== config.ADMIN_PASSWORD) {
    redirect("/login?error=1");
  }

  const store = await cookies();
  // ponytail: the cookie value IS the shared password — no session id, no
  // expiry beyond maxAge. Demo-only, see lib/auth.ts.
  store.set(AUTH_COOKIE, config.ADMIN_PASSWORD, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  redirect("/");
}
