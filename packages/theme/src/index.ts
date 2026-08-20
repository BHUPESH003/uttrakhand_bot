/**
 * Single source of truth for every visual theme value: colors, fonts, and
 * the emblem asset path. apps/web and apps/admin both read colors/fonts
 * from here in their tailwind.config.ts, and import `theme` directly for
 * anything Tailwind doesn't cover (e.g. the emblem <img> src). Swap the
 * uk.gov.in palette in here once the real brand values are available —
 * nothing else should hardcode a color, font, or asset path.
 */
export const theme = {
  colors: {
    // ponytail: placeholder navy/green — swap for uk.gov.in's exact hex values here only.
    navy: {
      50: "#eef1f6",
      100: "#d3dbe8",
      200: "#a7b7d1",
      300: "#7b93ba",
      400: "#4f6fa3",
      500: "#2f4f7c",
      600: "#25406a",
      700: "#1c3157",
      800: "#142343",
      900: "#0b1530",
    },
    green: {
      50: "#eaf6ee",
      100: "#c9e8d3",
      500: "#1f7a3d",
      600: "#186530",
      700: "#124f26",
    },
    neutral: {
      50: "#f7f8fa",
      100: "#eceef2",
      300: "#c7ccd6",
      500: "#6b7280",
      700: "#374151",
      900: "#111827",
    },
    error: "#b3261e",
    background: "#f4f6f9",
    surface: "#ffffff",
  },
  fonts: {
    // Devanagari fallback so Hindi copy renders without a per-locale font stack.
    body: ['"Noto Sans"', '"Noto Sans Devanagari"', "system-ui", "sans-serif"],
    googleFontsHref:
      "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap",
  },
  emblemSrc: "/logo_uk.jpg",
  siteName: {
    en: "Government of Uttarakhand",
    hi: "उत्तराखंड सरकार",
  },
} as const;
