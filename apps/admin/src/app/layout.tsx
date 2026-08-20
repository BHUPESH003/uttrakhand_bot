import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { theme } from "theme";
import { cookies } from "next/headers";
import { AUTH_COOKIE, isAuthed } from "@/lib/auth";
import { logout } from "./logout/actions";

export const metadata: Metadata = {
  title: "Uttarakhand e-Seva — Admin",
  description: "Approval dashboard for Uttarakhand certificate applications",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const showLogout = isAuthed(store.get(AUTH_COOKIE)?.value);

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={theme.fonts.googleFontsHref} />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's cz-shortcut-listen)
          inject attributes onto <body> before React hydrates — harmless mismatch, not our markup. */}
      <body
        className="flex min-h-screen flex-col bg-background font-sans text-neutral-900 antialiased"
        suppressHydrationWarning
      >
        <header className="border-b-4 border-green-600 bg-navy-700 text-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-3">
              <span className="rounded bg-white p-1">
                <img src={theme.emblemSrc} alt="" className="h-9 w-auto" />
              </span>
              <span className="leading-tight">
                <p className="font-semibold">{theme.siteName.en} — Admin</p>
                <p className="text-sm text-white/80">Certificate Approval Dashboard</p>
              </span>
            </Link>
            {showLogout && (
              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-md border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  Log out
                </button>
              </form>
            )}
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-neutral-300 bg-surface px-4 py-4 text-center text-xs text-neutral-500">
          © 2026 {theme.siteName.en} — Admin. Demo dashboard, not for production use.
        </footer>
      </body>
    </html>
  );
}
