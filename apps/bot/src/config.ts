/**
 * Loads and validates every environment variable the bot needs, once, at
 * startup. If anything is missing or malformed, we throw immediately with a
 * clear list — better to crash on boot than fail confusingly mid-request.
 *
 * Import this module (not `process.env` directly) everywhere else in the app.
 */
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Bearer token sent as `Authorization: Bearer <token>` on every Graph API
  // call. From Meta dashboard > WhatsApp > API Setup.
  WHATSAPP_TOKEN: z.string().min(1, "WHATSAPP_TOKEN is required"),

  // The numeric ID Meta assigns to your WhatsApp sender number (NOT the
  // phone number itself). It's part of every Graph API URL we call.
  PHONE_NUMBER_ID: z.string().min(1, "PHONE_NUMBER_ID is required"),

  // Shared secret you invent and paste into the Meta dashboard's webhook
  // config. Meta echoes it back on the GET /webhook verification handshake
  // so we can confirm the request really came from Meta's setup flow.
  VERIFY_TOKEN: z.string().min(1, "VERIFY_TOKEN is required"),

  // Graph API version, e.g. "v21.0". Meta periodically deprecates old
  // versions, so this is configurable instead of hardcoded.
  GRAPH_API_VERSION: z.string().min(1).default("v21.0"),

  // Used by later phases to build links sent inside WhatsApp messages.
  WEB_FORM_URL: z.string().url("WEB_FORM_URL must be a valid URL"),

  // Used by later phases as an image message. Must be public HTTPS — Meta's
  // servers fetch it directly, it's never uploaded from this server.
  BANNER_IMAGE_URL: z.string().url("BANNER_IMAGE_URL must be a valid URL"),

  PORT: z.coerce.number().int().positive().default(3001),

  // Read directly by packages/db's PrismaClient too (same process env) —
  // validated here as well so the bot fails fast on boot instead of on the
  // first DB call. See docker-compose.yml at the repo root for local Postgres.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // How long a user can go quiet before their next message restarts the
  // conversation at WELCOME instead of resuming where they left off.
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),

  // Shared secret apps/admin must send (as `x-internal-secret`) to call
  // POST /internal/notify-approved. Same value must be set in apps/admin's
  // INTERNAL_API_SECRET.
  INTERNAL_API_SECRET: z.string().min(1, "INTERNAL_API_SECRET is required"),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Check apps/bot/.env against .env.example:\n${missing}`,
    );
  }

  return result.data;
}

export const config = loadConfig();
