/**
 * Loads and validates every environment variable this app needs, once, at
 * import time. Mirrors apps/bot's config.ts — fail fast on boot with a
 * clear list rather than crash confusingly mid-request. Next.js loads
 * .env.local automatically, so no dotenv import is needed here.
 */
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Demo-only shared password — see .env.example for why this isn't real auth.
  ADMIN_PASSWORD: z.string().min(1, "ADMIN_PASSWORD is required"),

  // Must match apps/bot's INTERNAL_API_SECRET.
  INTERNAL_API_SECRET: z.string().min(1, "INTERNAL_API_SECRET is required"),

  BOT_INTERNAL_URL: z.string().url("BOT_INTERNAL_URL must be a valid URL"),
  ADMIN_PUBLIC_URL: z.string().url("ADMIN_PUBLIC_URL must be a valid URL"),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Check apps/admin/.env.local against .env.example:\n${missing}`,
    );
  }

  return result.data;
}

export const config = loadConfig();
