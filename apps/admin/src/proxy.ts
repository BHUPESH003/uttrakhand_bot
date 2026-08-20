/**
 * Gates every page except /login, the certificate PDFs (WhatsApp's servers
 * must be able to fetch those without a login cookie), and the header logo
 * (should render on /login too, before the user's authenticated). See
 * lib/auth.ts for why this check is demo-only.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthed } from "./lib/auth";

export function proxy(request: NextRequest) {
  if (!isAuthed(request.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!login|certificates|logo_uk\\.jpg|_next/static|_next/image|favicon.ico).*)"],
};
