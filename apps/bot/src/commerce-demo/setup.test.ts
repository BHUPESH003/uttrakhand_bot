/**
 * Setup tooling: the Flow flags store, the client's management calls
 * (exact Graph paths, methods and body formats), and the demo:* script
 * itself (keys + config) run as a child process. No network.
 * Run: pnpm --filter bot test:unit
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const BASE_ENV = {
  WHATSAPP_TOKEN: "test-token-SECRET",
  PHONE_NUMBER_ID: "111222333",
  VERIFY_TOKEN: "v",
  WEB_FORM_URL: "https://example.com/form",
  BANNER_IMAGE_URL: "https://example.com/banner.png",
  DATABASE_URL: "postgresql://x",
  INTERNAL_API_SECRET: "internal-SECRET",
  AI_SERVICE_URL: "https://example.com/ai",
  AI_SERVICE_TOKEN: "a",
};
for (const [k, v] of Object.entries(BASE_ENV)) process.env[k] ??= v;

let cfg: typeof import("./config");
let clientMod: typeof import("../whatsapp/client");
before(async () => {
  cfg = await import("./config.js");
  clientMod = await import("../whatsapp/client.js");
});

describe("Flow flags store", () => {
  const fresh = () => new cfg.FlowConfigStore(join(mkdtempSync(join(tmpdir(), "flags-")), "flow-config.json"));

  it("defaults when there is no file", () => {
    assert.deepEqual(fresh().get(), { offersScreen: true, promoField: true, customAmount: true, maxQty: 10 });
  });

  it("set merges, validates and persists", () => {
    const store = fresh();
    assert.deepEqual(store.set({ offersScreen: false, maxQty: 5 }), { offersScreen: false, promoField: true, customAmount: true, maxQty: 5 });
    assert.deepEqual(JSON.parse(readFileSync(store.path, "utf-8")).maxQty, 5);
    assert.equal(new cfg.FlowConfigStore(store.path).get().offersScreen, false, "another reader sees it");
  });

  it("rejects bad values and unknown keys, leaving the file alone", () => {
    const store = fresh();
    store.set({ maxQty: 4 });
    for (const bad of [{ maxQty: 0 }, { maxQty: 21 }, { maxQty: 2.5 }, { offersScreen: "no" }, { colour: "red" }] as const) {
      assert.throws(() => store.set(bad as never), /./, JSON.stringify(bad));
    }
    assert.equal(store.get().maxQty, 4);
  });

  it("picks up an external write (mtime change) without a restart", () => {
    const store = fresh();
    store.set({ promoField: true });
    assert.equal(store.get().promoField, true); // cached
    writeFileSync(store.path, JSON.stringify({ promoField: false }));
    const later = new Date(statSync(store.path).mtimeMs + 2000);
    utimesSync(store.path, later, later);
    assert.equal(store.get().promoField, false);
  });

  it("an invalid file falls back to defaults", () => {
    const store = fresh();
    writeFileSync(store.path, "{ not json");
    assert.deepEqual(store.get(), cfg.DEFAULT_FLOW_CONFIG);
  });
});

describe("WhatsAppClient management calls (paths verified against Meta docs)", () => {
  type Call = { method: string; url: URL; headers: Record<string, string>; body: unknown };
  async function capture(fn: (client: InstanceType<typeof clientMod.WhatsAppClient>) => Promise<unknown>, response: object = { success: true }) {
    const calls: Call[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url: new URL(String(url)), headers: init?.headers as Record<string, string>, body: init?.body });
      return Response.json(response);
    }) as typeof fetch;
    try {
      await fn(new clientMod.WhatsAppClient({ phoneNumberId: "PNID", token: "TOKEN", graphApiVersion: "v21.0" }));
    } finally {
      globalThis.fetch = real;
    }
    return calls;
  }

  it("uploads the public key as form field business_public_key, and reads it back", async () => {
    const [set, get] = await capture(async (c) => {
      await c.setBusinessPublicKey("-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----\n");
      await c.getBusinessPublicKey();
    });
    assert.equal(set!.method, "POST");
    assert.equal(set!.url.pathname, "/v21.0/PNID/whatsapp_business_encryption");
    assert.ok(set!.body instanceof URLSearchParams);
    assert.match((set!.body as URLSearchParams).get("business_public_key")!, /BEGIN PUBLIC KEY/);
    assert.equal(set!.headers.Authorization, "Bearer TOKEN");
    assert.equal(get!.method, "GET");
    assert.equal(get!.url.pathname, "/v21.0/PNID/whatsapp_business_encryption");
  });

  it("creates a Flow on /{WABA}/flows with JSON body (no app id there), then sets application_id on /{FLOW}", async () => {
    const [create, meta] = await capture(async (c) => {
      await c.createFlow("WABA", { name: "commerce-demo", categories: ["OTHER"], endpointUri: "https://bot/flows/commerce-demo", flowJson: '{"version":"7.3"}' });
      await c.updateFlowMetadata("FLOW", { applicationId: "APP" });
    });
    assert.equal(create!.url.pathname, "/v21.0/WABA/flows");
    assert.equal(create!.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(String(create!.body)), {
      name: "commerce-demo",
      categories: ["OTHER"],
      endpoint_uri: "https://bot/flows/commerce-demo",
      flow_json: '{"version":"7.3"}',
    });
    assert.equal(meta!.url.pathname, "/v21.0/FLOW");
    assert.deepEqual(JSON.parse(String(meta!.body)), { application_id: "APP" });
  });

  it("uploads Flow JSON as multipart (file, name=flow.json, asset_type=FLOW_JSON); publishes; reads health for this number", async () => {
    const [upload, publish, get] = await capture(async (c) => {
      await c.uploadFlowJson("FLOW", '{"version":"7.3"}');
      await c.publishFlow("FLOW");
      await c.getFlow("FLOW");
    });
    assert.equal(upload!.url.pathname, "/v21.0/FLOW/assets");
    const form = upload!.body as FormData;
    assert.equal(form.get("name"), "flow.json");
    assert.equal(form.get("asset_type"), "FLOW_JSON");
    assert.equal(await (form.get("file") as Blob).text(), '{"version":"7.3"}');
    assert.equal(publish!.method, "POST");
    assert.equal(publish!.url.pathname, "/v21.0/FLOW/publish");
    assert.match(get!.url.searchParams.get("fields")!, /validation_errors.*health_status\.phone_number\(PNID\)/);
    assert.doesNotMatch(get!.url.searchParams.get("fields")!, /preview/);
  });

  it("commerce settings: GET, and POST with is_cart_enabled / is_catalog_visible query params", async () => {
    const [set, get] = await capture(async (c) => {
      await c.setCommerceSettings({ isCartEnabled: true, isCatalogVisible: false });
      await c.getCommerceSettings();
    });
    assert.equal(set!.method, "POST");
    assert.equal(set!.url.pathname, "/v21.0/PNID/whatsapp_commerce_settings");
    assert.equal(set!.url.searchParams.get("is_cart_enabled"), "true");
    assert.equal(set!.url.searchParams.get("is_catalog_visible"), "false");
    assert.equal(get!.url.pathname, "/v21.0/PNID/whatsapp_commerce_settings");
  });

  it("Meta errors become WhatsAppApiError with code + fbtrace id", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ error: { message: "Invalid parameter", code: 100, fbtrace_id: "TRACE" } }, { status: 400 })) as typeof fetch;
    try {
      await assert.rejects(new clientMod.WhatsAppClient({ phoneNumberId: "P", token: "T" }).publishFlow("F"), (e: any) => {
        assert.ok(e instanceof clientMod.WhatsAppApiError);
        assert.equal(e.code, 100);
        assert.equal(e.fbtraceId, "TRACE");
        return true;
      });
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("demo:* script", () => {
  const script = join(__dirname, "../../scripts/demo.ts");
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
      encoding: "utf-8",
      cwd: join(__dirname, "../.."), // apps/bot, so tsx resolves
      // ...but never load apps/bot/.env (real secrets): dotenv honours DOTENV_CONFIG_PATH.
      env: { PATH: process.env.PATH ?? "", DOTENV_CONFIG_PATH: join(tmpdir(), "no-such.env"), ...env },
    });

  it("keys: writes a 2048-bit pair, prints only the public key, refuses to overwrite without --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "demo-data-"));
    const first = run(["keys"], { DEMO_DATA_DIR: dir });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /-----BEGIN PUBLIC KEY-----/);
    assert.doesNotMatch(first.stdout + first.stderr, /PRIVATE KEY-----/);
    const privatePem = readFileSync(join(dir, "keys", "private.pem"), "utf-8");
    assert.match(privatePem, /-----BEGIN PRIVATE KEY-----/);
    assert.equal(statSync(join(dir, "keys", "private.pem")).mode & 0o777, 0o600);
    const { createPrivateKey } = require("node:crypto") as typeof import("node:crypto");
    assert.equal(createPrivateKey(privatePem).asymmetricKeyDetails?.modulusLength, 2048);

    const again = run(["keys"], { DEMO_DATA_DIR: dir });
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists.*--force/s);
    assert.equal(readFileSync(join(dir, "keys", "private.pem"), "utf-8"), privatePem, "not overwritten");
    assert.equal(run(["keys", "--force"], { DEMO_DATA_DIR: dir }).status, 0);
  });

  it("config: prints, sets and validates the flags; never prints secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "demo-data-"));
    const env = { ...BASE_ENV, DEMO_DATA_DIR: dir };
    const set = run(["config", "--set", "offersScreen=false", "--set", "maxQty=6"], env);
    assert.equal(set.status, 0, set.stderr);
    assert.match(set.stdout, /"offersScreen": false/);
    assert.match(set.stdout, /"maxQty": 6/);
    const bad = run(["config", "--set", "maxQty=99"], env);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Invalid flags/);
    for (const out of [set.stdout + set.stderr, bad.stdout + bad.stderr]) assert.doesNotMatch(out, /SECRET/);
  });

  it("flow:create explains a missing WABA_ID before calling Meta", () => {
    const out = run(["flow:create"], { ...BASE_ENV, DEMO_DATA_DIR: mkdtempSync(join(tmpdir(), "d-")) });
    assert.equal(out.status, 1);
    assert.match(out.stderr, /WABA_ID is not set/);
  });

  it("unknown command lists the valid ones", () => {
    const out = run(["nope"], {});
    assert.equal(out.status, 1);
    assert.match(out.stderr, /keys, encryption, flow:create/);
  });
});
