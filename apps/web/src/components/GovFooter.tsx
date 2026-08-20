import { theme } from "@/theme";

/**
 * A footer styled after the standard Indian state-government site pattern
 * (thin accent strip → dark nav-link bar → browser-support notice → plain
 * copyright/contact strip with a live date → "Designed by NIC" bar with a
 * back-to-top link) — this is what makes the demo *feel* like a real
 * government portal rather than a generic web app. Links are inert (no
 * pages exist behind them in this demo) so they're plain text, not <a>s
 * pointing nowhere.
 */
const FOOTER_LINKS = [
  "Disclaimer",
  "Privacy Policy",
  "Help",
  "Copyright Policy",
  "Accessibility Statement",
  "Contact Us",
  "Terms & Conditions",
  "Public Grievance",
  "Site Map",
];

function currentDateLabel(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${now.getFullYear()}`;
}

export function GovFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="text-sm">
      <div className="h-3 bg-navy-100" />

      <div className="bg-navy-700 px-4 py-3">
        <ul className="mx-auto flex max-w-4xl flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-white/90">
          {FOOTER_LINKS.map((link) => (
            <li key={link}>{link}</li>
          ))}
        </ul>
      </div>

      <div className="bg-navy-800 px-4 py-2 text-center text-xs text-white/70">
        For Best Experience view this site in 1366×768 resolution. Supports all modern browsers —
        Chrome, Firefox, Edge, Safari.
      </div>

      <div className="border-t border-neutral-300 bg-surface px-4 py-3 text-center text-xs text-neutral-500">
        <p>
          Content Owned, Maintained and Updated by {theme.siteName.en}. Copyright Reserved © {year}.
          For any query, please contact the concerned department. (Technical Support by NIC)
        </p>
        <p className="mt-1">Current Date: {currentDateLabel()}</p>
      </div>

      <div className="flex items-center justify-between bg-navy-700 px-4 py-2 text-xs text-white/80">
        <span>Designed, Developed &amp; Hosted by NIC</span>
        <a href="#top" className="rounded border border-white/30 px-2 py-1 hover:bg-white/10">
          Top ▲
        </a>
      </div>
    </footer>
  );
}
