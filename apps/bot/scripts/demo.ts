/**
 * Commerce-demo setup commands (see docs/commerce-demo.md for the order).
 * Run from the repo root as `pnpm --filter bot demo:<command> [flags]`.
 *
 *   keys            RSA-2048 key pair into .demo-data/keys (git-ignored), prints the PUBLIC key
 *   encryption      upload the public key to the phone number, then print its signature status
 *   flow:create     create the Flow (endpoint_uri + Flow JSON), connect the Meta app, print validation errors
 *   flow:update     upload a new Flow JSON (and optionally a new endpoint_uri) for an existing Flow
 *   flow:publish    publish the Flow (irreversible; needs --yes)
 *   flow:send       ask the running bot to send the Flow (mode draft|published) to a test recipient
 *   send carousel|catalog   ask the running bot to send the brand carousel / product list
 *   commerce        read, and with flags set, the number's commerce settings (cart, catalog visibility)
 *   config          read, and with --set, the Flow flags (offersScreen, promoField, customAmount, maxQty)
 *
 * Every Graph call goes through WhatsAppClient (it logs method, path and
 * Meta's response). Nothing here prints the access token, app secret,
 * internal secret or private key, and recipient numbers are masked.
 */
import "dotenv/config";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const [command, ...rest] = process.argv.slice(2);
const FLOW_JSON_PATH = join(__dirname, "..", "flows", "commerce-demo.flow.json");
// Same default as src/commerce-demo/config.ts, without loading the full bot config
// (demo:keys must work before .env is filled in).
const dataDir = () => resolve(process.env.DEMO_DATA_DIR || join(__dirname, "..", ".demo-data"));
const keyPaths = () => ({ dir: join(dataDir(), "keys"), privateKey: join(dataDir(), "keys", "private.pem"), publicKey: join(dataDir(), "keys", "public.pem") });

const say = (line = "") => console.log(line);
const show = (label: string, value: unknown) => console.log(`${label}:\n${JSON.stringify(value, null, 2)}`);

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function need(name: string, value: string | undefined, hint: string): string {
  if (!value) fail(`${name} is not set. ${hint}`);
  return value;
}

const bool = (name: string, v: string | undefined) => {
  if (v === undefined) return undefined;
  if (v !== "true" && v !== "false") fail(`--${name} must be true or false`);
  return v === "true";
};

async function loadBot() {
  const { config } = await import("../src/config.js");
  const { WhatsAppClient, maskPhone } = await import("../src/whatsapp/client.js");
  return { config, client: new WhatsAppClient(), maskPhone };
}

function printValidationErrors(errors: unknown[] | undefined) {
  if (!errors || errors.length === 0) {
    say("✔ Meta reported no Flow JSON validation errors.");
    return;
  }
  say(`✖ Meta reported ${errors.length} Flow JSON validation error(s):`);
  for (const e of errors as Array<Record<string, unknown>>) {
    const where = e.line_start ? ` (line ${e.line_start}:${e.column_start})` : "";
    const path = Array.isArray(e.pointers) && e.pointers[0] ? ` at ${(e.pointers[0] as { path?: string }).path}` : "";
    say(`  - ${e.error ?? "ERROR"}: ${e.message}${where}${path}`);
  }
}

async function printFlowStatus(client: { getFlow(id: string): Promise<unknown> }, flowId: string) {
  const flow = (await client.getFlow(flowId)) as Record<string, any>;
  say(`Flow ${flow.id} "${flow.name}": status ${flow.status}, JSON ${flow.json_version ?? "?"}, data API ${flow.data_api_version ?? "?"}`);
  say(`endpoint_uri: ${flow.endpoint_uri ?? "(not set)"}`);
  printValidationErrors(flow.validation_errors);
  const health = flow.health_status;
  if (health) {
    say(`can_send_message: ${health.can_send_message}`);
    for (const entity of health.entities ?? []) {
      for (const err of entity.errors ?? []) say(`  ✖ ${entity.entity_type}: ${err.error_description} (code ${err.error_code})`);
      for (const info of entity.additional_info ?? []) say(`  ! ${entity.entity_type}: ${info}`);
    }
  }
}

/** POST to the running bot's internal API (the Flow session must live in the bot process). */
async function callBot(path: string, body: unknown, botUrl: string, secret: string) {
  let res: Response;
  try {
    res = await fetch(`${botUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(body),
    });
  } catch {
    fail(`Could not reach the bot at ${botUrl}. Start it first (pnpm dev:bot) or pass --bot-url.`);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  show(`Bot responded ${res.status}`, json);
  if (!res.ok) fail(String(json.error ?? `bot returned ${res.status}`));
}

const commands: Record<string, () => Promise<void>> = {
  async keys() {
    const { values } = parseArgs({ args: rest, options: { force: { type: "boolean", default: false } } });
    const paths = keyPaths();
    if (existsSync(paths.privateKey) && !values.force) {
      fail(
        `${paths.privateKey} already exists. A new key pair invalidates the one uploaded to Meta ` +
          "(you'd have to run demo:encryption again). Pass --force to replace it.",
      );
    }
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    writeFileSync(paths.privateKey, privateKey, { mode: 0o600 });
    writeFileSync(paths.publicKey, publicKey, { mode: 0o644 });
    say(`Generated a 2048-bit RSA key pair.`);
    say(`  private key: ${paths.privateKey} (mode 600, never printed, git-ignored)`);
    say(`  public key:  ${paths.publicKey}`);
    say();
    say(publicKey.trim());
    say();
    say(`Next: set FLOW_PRIVATE_KEY_PATH=${paths.privateKey} in apps/bot/.env, then run demo:encryption.`);
  },

  async encryption() {
    const { values } = parseArgs({ args: rest, options: { "status-only": { type: "boolean", default: false } } });
    const { client } = await loadBot();
    if (!values["status-only"]) {
      const pem = readFileSync(keyPaths().publicKey, "utf-8");
      say("Uploading the public key to this phone number (Meta signs it on upload)...");
      show("Meta response", await client.setBusinessPublicKey(pem));
    }
    const status = (await client.getBusinessPublicKey()) as { data?: Array<{ business_public_key_signature_status?: string }> };
    const signature = status.data?.[0]?.business_public_key_signature_status ?? "(none)";
    say(`business_public_key_signature_status: ${signature}`);
    if (signature !== "VALID") fail("Signature is not VALID. Re-run demo:encryption; if it persists, regenerate keys (demo:keys --force).");
    say("✔ Key is uploaded and signed.");
  },

  async "flow:create"() {
    const { values } = parseArgs({
      args: rest,
      options: {
        name: { type: "string", default: "commerce-demo" },
        category: { type: "string", default: "OTHER" },
        "endpoint-uri": { type: "string" },
        force: { type: "boolean", default: false },
      },
    });
    const { config, client } = await loadBot();
    const wabaId = need("WABA_ID", config.WABA_ID, "WhatsApp Manager > Account tools > WhatsApp Business Account ID.");
    const appId = need("META_APP_ID", config.META_APP_ID, "App dashboard > App settings > Basic > App ID.");
    const base = values["endpoint-uri"] ?? (config.BOT_PUBLIC_URL ? `${config.BOT_PUBLIC_URL.replace(/\/$/, "")}/flows/commerce-demo` : undefined);
    const endpointUri = need("endpoint URI", base, "Set BOT_PUBLIC_URL (public HTTPS URL of this bot) or pass --endpoint-uri.");
    if (config.COMMERCE_FLOW_ID && !values.force) {
      fail(`COMMERCE_FLOW_ID=${config.COMMERCE_FLOW_ID} is already set. Use demo:flow:update, or pass --force to create another Flow.`);
    }

    say(`Creating Flow "${values.name}" (DRAFT) with endpoint_uri ${endpointUri} and ${FLOW_JSON_PATH}...`);
    const created = await client.createFlow(wabaId, {
      name: values.name!,
      categories: [values.category!],
      endpointUri,
      flowJson: readFileSync(FLOW_JSON_PATH, "utf-8"),
    });
    show("Meta response", created);
    if (!created.id) fail("Meta did not return a Flow id.");
    printValidationErrors(created.validation_errors);

    say(`Connecting Meta app ${appId} to the Flow (application_id)...`);
    show("Meta response", await client.updateFlowMetadata(created.id, { applicationId: appId }));
    await printFlowStatus(client, created.id);
    say();
    say(`Next: add COMMERCE_FLOW_ID=${created.id} to apps/bot/.env and restart the bot.`);
  },

  async "flow:update"() {
    const { values } = parseArgs({ args: rest, options: { "flow-id": { type: "string" }, "endpoint-uri": { type: "string" } } });
    const { config, client } = await loadBot();
    const flowId = need("Flow id", values["flow-id"] ?? config.COMMERCE_FLOW_ID, "Set COMMERCE_FLOW_ID or pass --flow-id.");
    if (values["endpoint-uri"]) {
      say(`Updating endpoint_uri to ${values["endpoint-uri"]}...`);
      show("Meta response", await client.updateFlowMetadata(flowId, { endpointUri: values["endpoint-uri"] }));
    }
    say(`Uploading ${FLOW_JSON_PATH} to Flow ${flowId}...`);
    const result = await client.uploadFlowJson(flowId, readFileSync(FLOW_JSON_PATH, "utf-8"));
    show("Meta response", result);
    printValidationErrors(result.validation_errors);
    await printFlowStatus(client, flowId);
  },

  async "flow:publish"() {
    const { values } = parseArgs({ args: rest, options: { "flow-id": { type: "string" }, yes: { type: "boolean", default: false } } });
    const { config, client } = await loadBot();
    const flowId = need("Flow id", values["flow-id"] ?? config.COMMERCE_FLOW_ID, "Set COMMERCE_FLOW_ID or pass --flow-id.");
    if (!values.yes) {
      fail("Publishing is irreversible: a published Flow can't be edited or deleted, only deprecated. Re-run with --yes.");
    }
    say(`Publishing Flow ${flowId}...`);
    show("Meta response", await client.publishFlow(flowId));
    await printFlowStatus(client, flowId);
    say("Next: set COMMERCE_FLOW_MODE=published in apps/bot/.env and restart the bot.");
  },

  async "flow:send"() {
    const { values } = parseArgs({
      args: rest,
      options: {
        to: { type: "string" },
        mode: { type: "string" },
        screen: { type: "string", default: "ITEM" },
        brand: { type: "string", default: "brand_a" },
        "bot-url": { type: "string" },
      },
    });
    const { config, maskPhone } = await loadBot();
    const to = need("recipient", values.to ?? config.DEMO_TEST_RECIPIENT, "Pass --to 91XXXXXXXXXX or set DEMO_TEST_RECIPIENT.");
    const mode = values.mode ?? config.COMMERCE_FLOW_MODE;
    if (mode !== "draft" && mode !== "published") fail("--mode must be draft or published");
    say(`Asking the bot to send the Flow (${mode}, screen ${values.screen}) to ${maskPhone(to)}...`);
    await callBot(
      "/internal/demo/send",
      { to, kind: "flow", mode, screen: values.screen, brandId: values.brand },
      values["bot-url"] ?? `http://localhost:${config.PORT}`,
      config.INTERNAL_API_SECRET,
    );
  },

  async send() {
    const [kind, ...flags] = rest;
    if (kind !== "carousel" && kind !== "catalog") fail("usage: demo:send:carousel | demo:send:catalog [--to N] [--bot-url URL]");
    const { values } = parseArgs({ args: flags, options: { to: { type: "string" }, "bot-url": { type: "string" } } });
    const { config, maskPhone } = await loadBot();
    const to = need("recipient", values.to ?? config.DEMO_TEST_RECIPIENT, "Pass --to 91XXXXXXXXXX or set DEMO_TEST_RECIPIENT.");
    say(`Asking the bot to send the ${kind} to ${maskPhone(to)}...`);
    await callBot("/internal/demo/send", { to, kind }, values["bot-url"] ?? `http://localhost:${config.PORT}`, config.INTERNAL_API_SECRET);
  },

  async commerce() {
    const { values } = parseArgs({ args: rest, options: { cart: { type: "string" }, "catalog-visible": { type: "string" } } });
    const { client } = await loadBot();
    const isCartEnabled = bool("cart", values.cart);
    const isCatalogVisible = bool("catalog-visible", values["catalog-visible"]);
    if (isCartEnabled !== undefined || isCatalogVisible !== undefined) {
      say(`Setting commerce settings: ${JSON.stringify({ is_cart_enabled: isCartEnabled, is_catalog_visible: isCatalogVisible })}`);
      show("Meta response", await client.setCommerceSettings({ isCartEnabled, isCatalogVisible }));
    }
    show("Current commerce settings", await client.getCommerceSettings());
  },

  async config() {
    const { values } = parseArgs({ args: rest, options: { set: { type: "string", multiple: true } } });
    await loadBot(); // validates .env like the bot does
    const { flowConfig } = await import("../src/commerce-demo/config.js");
    say(`Flow flags file: ${flowConfig.path}`);
    if (values.set?.length) {
      const patch: Record<string, unknown> = {};
      for (const pair of values.set) {
        const [key, raw] = pair.split("=", 2);
        if (!key || raw === undefined) fail(`--set expects key=value, got "${pair}"`);
        patch[key] = raw === "true" ? true : raw === "false" ? false : Number.isNaN(Number(raw)) ? raw : Number(raw);
      }
      try {
        flowConfig.set(patch);
      } catch (err) {
        fail(`Invalid flags: ${err instanceof Error ? err.message : err}`);
      }
      say("Saved. New Flow sessions use these flags; Flows already open keep their snapshot.");
    }
    show("Flow flags", flowConfig.get());
  },
};

const run = commands[command ?? ""];
if (!run) {
  console.error(`Unknown command "${command ?? ""}". One of: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
run().catch(async (err: unknown) => {
  const { WhatsAppApiError } = await import("../src/whatsapp/client.js");
  if (err instanceof WhatsAppApiError) {
    fail(`Meta error ${err.code}: ${err.message}${err.fbtraceId ? ` (fbtrace_id ${err.fbtraceId})` : ""}`);
  }
  fail(err instanceof Error ? err.message : String(err));
});
