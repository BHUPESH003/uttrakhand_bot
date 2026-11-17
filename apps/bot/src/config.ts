/**
 * Loads and validates every environment variable the bot needs, once, at
 * startup. If anything is missing or malformed, we throw immediately with a
 * clear list — better to crash on boot than fail confusingly mid-request.
 *
 * Import this module (not `process.env` directly) everywhere else in the app.
 */
import "dotenv/config";
import { z } from "zod";

/** "a, b,,c" -> ["a","b","c"]; unset -> []. */
const csvList = z
  .string()
  .default("")
  .transform((csv) => csv.split(",").map((item) => item.trim()).filter(Boolean));

/** Optional string where an empty value (`FOO=` in .env) counts as unset. */
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

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

  // Base URL of the external "Chat with us" AI service — see
  // flow/aiChat.ts. We POST to `${AI_SERVICE_URL}/v1/converse`.
  AI_SERVICE_URL: z.string().url("AI_SERVICE_URL must be a valid URL"),

  // Sent as `Authorization: Bearer <token>` on every AI service call.
  AI_SERVICE_TOKEN: z.string().min(1, "AI_SERVICE_TOKEN is required"),

  // Reject an inbound voice note larger than this instead of forwarding it
  // to the AI service — see ai-voice-handoff-contract.html#media-limits.
  // Meta's webhook never reports voice-note duration, only byte size (from
  // the media-info lookup), so the cap is size-based. Default ~2MB is
  // generously above a 2-minute clip at typical Opus voice-note bitrates.
  AI_VOICE_MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(2_000_000),

  // Which fake dataset the commerce demo serves — see
  // commerce-demo/data/catalog.ts. "voucher" is opt-in only.
  DEMO_DATASET: z.enum(["neutral", "voucher"]).default("neutral"),

  // Comma-separated PHONE_NUMBER_IDs (real/production senders) that must
  // never run DEMO_DATASET=voucher — enforced by the refine below.
  PROTECTED_PHONE_NUMBER_IDS: csvList,

  // Commerce demo send guard (commerce-demo/sendGuard.ts): demo messages go
  // out only when this is exactly "true" AND the recipient is allowlisted.
  // Does not affect the certificate service's sends.
  DEMO_SEND_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // Comma-separated recipient numbers, same format as `to` (e.g. 919812345678).
  DEMO_ALLOWED_RECIPIENTS: csvList,

  // WhatsApp Pay (India) payment configuration name from Meta Business
  // Suite. Unset (the default) = order_details/order_status are never sent
  // to Meta; the demo payment provider is used instead.
  WA_PAYMENT_CONFIG_NAME: optionalString,

  // Commerce-demo Flow endpoint (POST /flows/commerce-demo). Registered only
  // when both the private key and app secret are set, so the certificate
  // bot boots without them. The key is the PEM whose public half was
  // uploaded to Meta (scripts/ will do that); "\n" escapes are accepted so
  // it fits on one .env line.
  FLOW_PRIVATE_KEY: optionalString.transform((pem) => pem?.replace(/\\n/g, "\n")),
  // Alternative to FLOW_PRIVATE_KEY: path to the PEM file (what `pnpm
  // demo:keys` writes), so the key never has to be pasted into .env.
  FLOW_PRIVATE_KEY_PATH: optionalString,
  FLOW_PRIVATE_KEY_PASSPHRASE: optionalString,
  // App secret of the Meta app connected to the Flow — verifies X-Hub-Signature-256.
  META_APP_SECRET: optionalString,

  // The commerce-demo Flow's id from WhatsApp Manager (after uploading
  // flows/commerce-demo.flow.json). Unset = "Buy" explains the amount
  // picker isn't available instead of sending a Flow.
  COMMERCE_FLOW_ID: optionalString,
  // "draft" opens the latest draft (works before publishing, for test
  // numbers); switch to "published" once the Flow is published.
  COMMERCE_FLOW_MODE: z.enum(["draft", "published"]).default("draft"),

  // Catalog path of the commerce demo (Browse catalog, single-product
  // cards, cart orders). Off unless exactly "true"; needs the Commerce
  // Manager catalog id (the catalog must be linked to this WhatsApp number).
  COMMERCE_CATALOG_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  COMMERCE_CATALOG_ID: optionalString,

  // ---- Only used by the demo:* setup scripts (apps/bot/scripts) ----
  // WhatsApp Business Account id (owns Flows; WhatsApp Manager > Account tools).
  WABA_ID: optionalString,
  // Meta app id, connected to the Flow so it can call our endpoint.
  META_APP_ID: optionalString,
  // Public HTTPS base URL of this bot (ngrok or the VM domain); the Flow's
  // endpoint_uri becomes `${BOT_PUBLIC_URL}/flows/commerce-demo`.
  BOT_PUBLIC_URL: optionalString,
  // Default `--to` for the demo:send/demo:flow:send scripts (must also be in DEMO_ALLOWED_RECIPIENTS).
  DEMO_TEST_RECIPIENT: optionalString,

  // Git-ignored folder for demo keys and the Flow config flags file.
  // Defaults to apps/bot/.demo-data.
  DEMO_DATA_DIR: optionalString,
})
.refine((env) => !env.COMMERCE_CATALOG_ENABLED || env.COMMERCE_CATALOG_ID, {
  path: ["COMMERCE_CATALOG_ID"],
  message: "COMMERCE_CATALOG_ID is required when COMMERCE_CATALOG_ENABLED=true",
})
.refine(
  (env) =>
    !(env.DEMO_DATASET === "voucher" && env.PROTECTED_PHONE_NUMBER_IDS.includes(env.PHONE_NUMBER_ID)),
  {
    path: ["DEMO_DATASET"],
    message: "DEMO_DATASET=voucher is not allowed on a PHONE_NUMBER_ID listed in PROTECTED_PHONE_NUMBER_IDS",
  },
);

/** Exported for the commerce-demo self-check (startup guard test); everything else imports `config`. */
export { envSchema };

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
