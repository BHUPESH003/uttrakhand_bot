import type { Config } from "tailwindcss";
import { theme } from "./src/theme";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: theme.colors.navy,
        green: theme.colors.green,
        neutral: theme.colors.neutral,
        error: theme.colors.error,
        background: theme.colors.background,
        surface: theme.colors.surface,
      },
      fontFamily: {
        sans: theme.fonts.body,
      },
    },
  },
} satisfies Config;
