import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { theme } from "@/theme";
import { GovFooter } from "@/components/GovFooter";

export const metadata: Metadata = {
  title: "Uttarakhand e-Seva",
  description: "Apply for and track Uttarakhand government certificates",
};

export default function RootLayout({ children }: { children: ReactNode }) {
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
        <header id="top" className="border-b-4 border-green-600 bg-navy-700 text-white">
          <div className="mx-auto max-w-3xl px-4 py-3">
            <Link href="/" className="flex items-center gap-3">
              <span className="rounded bg-white p-1">
                <img src={theme.emblemSrc} alt="" className="h-9 w-auto" />
              </span>
              <span className="leading-tight">
                <p className="font-semibold">{theme.siteName.en}</p>
                <p className="text-sm text-white/80">{theme.siteName.hi}</p>
              </span>
            </Link>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <GovFooter />
      </body>
    </html>
  );
}
