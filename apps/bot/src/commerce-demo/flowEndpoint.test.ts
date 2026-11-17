/**
 * Commerce-demo Flow endpoint, end to end through Fastify inject: a
 * generated RSA key pair, requests encrypted + signed the way WhatsApp
 * does it, responses decrypted with the flipped IV. Also checks the Flow
 * JSON against the handler (routing_model covers every route, screen data
 * matches each screen's declared data model). No network, no Postgres.
 * Run: pnpm --filter bot test:unit
 */
import assert from "node:assert/strict";
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHmac,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

for (const [k, v] of Object.entries({
  WHATSAPP_TOKEN: "test-token",
  PHONE_NUMBER_ID: "test-phone-id",
  VERIFY_TOKEN: "v",
  WEB_FORM_URL: "https://example.com/form",
  BANNER_IMAGE_URL: "https://example.com/banner.png",
  DATABASE_URL: "postgresql://x",
  INTERNAL_API_SECRET: "s",
  AI_SERVICE_URL: "https://example.com/ai",
  AI_SERVICE_TOKEN: "a",
})) process.env[k] ??= v;

const APP_SECRET = "test-app-secret";
const USER = "919812345678";
const flowJson = JSON.parse(readFileSync(join(__dirname, "../../flows/commerce-demo.flow.json"), "utf-8"));

type Mods = {
  handler: typeof import("./flowHandler");
  sessions: typeof import("./sessions");
  crypto: typeof import("../whatsapp/flowCrypto");
  data: typeof import("./data/catalog") & typeof import("./data/orders");
  route: typeof import("../routes/flowEndpoint");
};
let m: Mods;
let keys: { publicKey: KeyObject; privateKey: KeyObject };

before(async () => {
  m = {
    handler: await import("./flowHandler.js"),
    sessions: await import("./sessions.js"),
    crypto: await import("../whatsapp/flowCrypto.js"),
    data: { ...(await import("./data/catalog.js")), ...(await import("./data/orders.js")) },
    route: await import("../routes/flowEndpoint.js"),
  };
  keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
});

/** One endpoint instance with its own clock, sessions and orders. */
async function setup(flags: Partial<import("./config").FlowConfig> = {}) {
  const { DEFAULT_FLOW_CONFIG } = await import("./config.js");
  const options = { ...DEFAULT_FLOW_CONFIG, ...flags };
  const Fastify = (await import("fastify")).default;
  let now = 1_000_000;
  const sessions = new m.sessions.InMemoryCommerceSessionStore(30 * 60_000, () => now);
  const orders = new m.data.OrderStore("DEMO-ITEM");
  const app: FastifyInstance = Fastify();
  m.route.registerFlowEndpointRoutes(app, {
    privateKey: keys.privateKey,
    appSecret: APP_SECRET,
    deps: { sessions, dataset: m.data.getDataset("neutral"), orders },
  });
  await app.ready();

  const start = (brandId = "brand_a", startScreen?: "ITEM" | "CUSTOM_AMOUNT") =>
    m.sessions.flowTokenFor(sessions.create({ userId: USER, brandId, startScreen, options }));
  /** Catalog path: Flow opened on OTHER_AMOUNT, no brand chosen yet. */
  const startOther = () => m.sessions.flowTokenFor(sessions.create({ userId: USER, startScreen: "OTHER_AMOUNT", options }));

  /** Encrypts like the WhatsApp client, signs like Meta, decrypts the reply. */
  async function call(payload: unknown, opts: { publicKey?: KeyObject; signature?: string; rawBody?: string } = {}) {
    const aesKey = randomBytes(16);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf-8"), cipher.final(), cipher.getAuthTag()]);
    const body = {
      encrypted_flow_data: encrypted.toString("base64"),
      encrypted_aes_key: publicEncrypt(
        { key: opts.publicKey ?? keys.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
        aesKey,
      ).toString("base64"),
      initial_vector: iv.toString("base64"),
    };
    const raw = opts.rawBody ?? JSON.stringify(body);
    const res = await app.inject({
      method: "POST",
      url: "/flows/commerce-demo",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": opts.signature ?? `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`,
      },
      payload: raw,
    });
    if (res.statusCode !== 200) return { status: res.statusCode, body: res.body as unknown as any };
    assert.match(res.headers["content-type"] as string, /^text\/plain/);
    const out = Buffer.from(res.body, "base64");
    const decipher = createDecipheriv("aes-128-gcm", aesKey, Buffer.from(iv.map((b) => ~b)));
    decipher.setAuthTag(out.subarray(-16));
    const json = Buffer.concat([decipher.update(out.subarray(0, -16)), decipher.final()]).toString("utf-8");
    return { status: 200, body: JSON.parse(json) };
  }

  const exchange = (token: string, screen: string, data: Record<string, unknown>) =>
    call({ version: "3.0", action: "data_exchange", screen, data, flow_token: token });
  const init = (token: string) => call({ version: "3.0", action: "INIT", flow_token: token });

  return { app, sessions, orders, options, start, startOther, call, exchange, init, advance: (ms: number) => (now += ms) };
}

describe("flow crypto", () => {
  it("round-trips request decryption and response encryption with the flipped IV", () => {
    const aesKey = randomBytes(16);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
    const payload = { action: "ping", version: "3.0" };
    const data = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]);
    const encKey = publicEncrypt({ key: keys.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, aesKey);
    const out = m.crypto.decryptFlowRequest(
      { encrypted_flow_data: data.toString("base64"), encrypted_aes_key: encKey.toString("base64"), initial_vector: iv.toString("base64") },
      keys.privateKey,
    );
    assert.deepEqual(out.payload, payload);
    assert.ok(out.aesKey.equals(aesKey));

    const b64 = m.crypto.encryptFlowResponse({ ok: 1 }, aesKey, iv);
    const buf = Buffer.from(b64, "base64");
    const d = createDecipheriv("aes-128-gcm", aesKey, m.crypto.flipIv(iv));
    d.setAuthTag(buf.subarray(-16));
    assert.equal(Buffer.concat([d.update(buf.subarray(0, -16)), d.final()]).toString(), '{"ok":1}');
  });

  it("flipIv matches Meta's sample (~byte)", () => {
    const iv = Buffer.from([0x00, 0xff, 0x0f, 0xa5]);
    assert.deepEqual([...m.crypto.flipIv(iv)], [...Buffer.from([...iv].map((b) => ~b))]);
    assert.deepEqual([...m.crypto.flipIv(iv)], [0xff, 0x00, 0xf0, 0x5a]);
  });

  it("verifies X-Hub-Signature-256", () => {
    const raw = Buffer.from('{"a":1}');
    const good = `sha256=${createHmac("sha256", "s").update(raw).digest("hex")}`;
    assert.equal(m.crypto.verifyMetaSignature(raw, good, "s"), true);
    assert.equal(m.crypto.verifyMetaSignature(raw, good, "other"), false);
    assert.equal(m.crypto.verifyMetaSignature(Buffer.from('{"a":2}'), good, "s"), false);
    assert.equal(m.crypto.verifyMetaSignature(raw, undefined, "s"), false);
    assert.equal(m.crypto.verifyMetaSignature(raw, "sha256=abc", "s"), false);
  });
});

describe("routing (pure)", () => {
  const all = [
    { offersScreen: true, promoField: true },
    { offersScreen: false, promoField: true },
    { offersScreen: true, promoField: false },
    { offersScreen: false, promoField: false },
  ];

  it("ITEM -> CUSTOM_AMOUNT for custom, else OFFERS (or REVIEW when offers are off)", () => {
    const on = all[0]!;
    const off = all[1]!;
    assert.equal(m.handler.nextScreen("ITEM", { amountChoice: "custom" }, on), "CUSTOM_AMOUNT");
    assert.equal(m.handler.nextScreen("ITEM", { amountChoice: "500" }, on), "OFFERS");
    assert.equal(m.handler.nextScreen("ITEM", { amountChoice: "500" }, off), "REVIEW");
    assert.equal(m.handler.nextScreen("CUSTOM_AMOUNT", {}, on), "OFFERS");
    assert.equal(m.handler.nextScreen("CUSTOM_AMOUNT", {}, off), "REVIEW");
    assert.equal(m.handler.nextScreen("OTHER_AMOUNT", {}, on), "OFFERS");
    assert.equal(m.handler.nextScreen("OTHER_AMOUNT", {}, off), "REVIEW");
    assert.equal(m.handler.nextScreen("OFFERS", {}, on), "REVIEW");
    assert.equal(m.handler.nextScreen("REVIEW", {}, on), "SUCCESS");
  });

  it("every route the server can take is declared in the Flow JSON routing_model", () => {
    for (const options of all) {
      for (const from of ["ITEM", "CUSTOM_AMOUNT", "OTHER_AMOUNT", "OFFERS", "REVIEW"] as const) {
        for (const amountChoice of ["custom", "500"]) {
          const to = m.handler.nextScreen(from, { amountChoice }, options);
          if (to === "SUCCESS") continue;
          assert.ok(flowJson.routing_model[from].includes(to), `${from} -> ${to} missing from routing_model`);
        }
      }
    }
  });
});

describe("Flow JSON", () => {
  it("uses Flow JSON 7.3 / data API 4.0, routing_model matches screens, max 10 branches", () => {
    assert.equal(flowJson.version, "7.3");
    assert.equal(flowJson.data_api_version, "4.0");
    const ids = flowJson.screens.map((s: any) => s.id);
    assert.deepEqual(Object.keys(flowJson.routing_model).sort(), [...ids].sort());
    assert.ok(!ids.includes("SUCCESS"));
    const branches = Object.values(flowJson.routing_model).flat().length;
    assert.ok(branches <= 10, `${branches} branches`);
    for (const s of flowJson.screens.filter((s: any) => s.terminal)) {
      assert.ok(s.layout.children.some((c: any) => c.type === "Footer"), `${s.id} terminal without Footer`);
    }
  });

  it("every ${data.x} is declared and every ${form.x} names a component on its screen", () => {
    for (const screen of flowJson.screens) {
      const json = JSON.stringify(screen.layout);
      const names = new Set(screen.layout.children.map((c: any) => c.name).filter(Boolean));
      for (const [, key] of json.matchAll(/\$\{data\.([\w-]+)\}/g)) assert.ok(key! in screen.data, `${screen.id}: data.${key} undeclared`);
      for (const [, key] of json.matchAll(/\$\{form\.([\w-]+)\}/g)) assert.ok(names.has(key), `${screen.id}: form.${key} unknown`);
      for (const [key, def] of Object.entries<any>(screen.data)) assert.ok("__example__" in def, `${screen.id}: ${key} has no __example__`);
    }
  });

  it("the handler's screen data matches each screen's declared data model exactly", async () => {
    const t = await setup();
    const seen: Record<string, string[]> = {};
    const record = (r: any) => (seen[r.body.screen] = Object.keys(r.body.data).filter((k) => k !== "error_message").sort());
    const custom = t.start();
    record(await t.init(custom));
    record(await t.exchange(custom, "ITEM", { amount: "custom", quantity: "1" }));
    record(await t.exchange(custom, "CUSTOM_AMOUNT", { custom_amount: "600" }));
    record(await t.exchange(custom, "OFFERS", { offer: "none", promo_code: "" }));
    record(await t.init(t.startOther()));
    for (const screen of flowJson.screens) {
      assert.deepEqual(seen[screen.id], Object.keys(screen.data).sort(), screen.id);
    }
  });
});

describe("POST /flows/commerce-demo", () => {
  it("ping -> active, no token needed", async () => {
    const t = await setup();
    assert.deepEqual(await t.call({ version: "3.0", action: "ping" }), { status: 200, body: { data: { status: "active" } } });
  });

  it("421 when the body can't be decrypted", async () => {
    const t = await setup();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    assert.equal((await t.call({ action: "ping" }, { publicKey: other.publicKey })).status, 421);
    assert.equal((await t.call(null, { rawBody: '{"encrypted_flow_data":"AAAA","encrypted_aes_key":"AAAA","initial_vector":"AAAA"}' })).status, 421);
    assert.equal((await t.call(null, { rawBody: '{"hello":"world"}' })).status, 421);
    assert.equal((await t.call(null, { rawBody: "not json" })).status, 421);
  });

  it("432 when the signature doesn't match", async () => {
    const t = await setup();
    assert.equal((await t.call({ action: "ping" }, { signature: "sha256=00" })).status, 432);
    assert.equal((await t.call({ action: "ping" }, { signature: `sha256=${createHmac("sha256", "wrong").update("x").digest("hex")}` })).status, 432);
  });

  it("427 for unknown, malformed or expired tokens", async () => {
    const t = await setup();
    for (const token of ["demo:nope", "not-a-demo-token", "demo:", undefined]) {
      const r = await t.init(token as string);
      assert.equal(r.status, 427, String(token));
      assert.match(JSON.parse(r.body).error_msg, /expired/);
    }
    const token = t.start();
    assert.equal((await t.init(token)).status, 200);
    t.advance(30 * 60_000 + 1);
    assert.equal((await t.init(token)).status, 427);
  });

  it("each request refreshes the session TTL", async () => {
    const t = await setup();
    const token = t.start();
    t.advance(20 * 60_000);
    assert.equal((await t.init(token)).status, 200);
    t.advance(20 * 60_000); // 40 min since start, 20 since last hit
    assert.equal((await t.init(token)).status, 200);
  });

  it("INIT -> ITEM with brand, presets + 'Other amount' last, quantities 1-10", async () => {
    const t = await setup();
    const r = await t.init(t.start());
    assert.equal(r.body.screen, "ITEM");
    assert.equal(r.body.data.brand_name, "Sample brand A");
    assert.deepEqual(r.body.data.presets.map((p: any) => p.id), ["250", "500", "1000", "2000", "5000", "custom"]);
    assert.equal(r.body.data.presets.at(-1).title, "Other amount");
    assert.equal(r.body.data.presets[2].title, "₹1,000");
    assert.deepEqual(r.body.data.quantities.map((q: any) => q.id), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  });

  it("INIT can open directly on CUSTOM_AMOUNT", async () => {
    const t = await setup();
    const token = t.start("brand_c", "CUSTOM_AMOUNT");
    const r = await t.init(token);
    assert.equal(r.body.screen, "CUSTOM_AMOUNT");
    assert.equal(r.body.data.helper_text, "Between ₹250 and ₹10,000 in steps of ₹250");
    const next = await t.exchange(token, "CUSTOM_AMOUNT", { custom_amount: "1500" });
    assert.equal(next.body.screen, "OFFERS"); // qty defaults to 1
  });

  it("preset amount: ITEM -> OFFERS with 'No offer' first and ineligible offers disabled", async () => {
    const t = await setup();
    const token = t.start();
    const r = await t.exchange(token, "ITEM", { amount: "250", quantity: "1" });
    assert.equal(r.body.screen, "OFFERS");
    const offers = r.body.data.offers;
    assert.deepEqual(offers[0], { id: "none", title: "No offer", description: "Continue without an offer", enabled: true });
    assert.deepEqual(offers.map((o: any) => [o.id, o.enabled]), [["none", true], ["WELCOME10", true], ["GIFT50", false], ["TREAT5", true]]);
    assert.match(offers[2].description, /Add ₹250 more to unlock/);
    assert.equal(r.body.data.show_promo, true);
  });

  it("ITEM rejects an unknown preset or a bad quantity with error_message", async () => {
    const t = await setup();
    const token = t.start();
    for (const data of [{ amount: "333", quantity: "1" }, { amount: "250", quantity: "11" }, { amount: "250", quantity: "0" }, {}]) {
      const r = await t.exchange(token, "ITEM", data);
      assert.equal(r.body.screen, "ITEM", JSON.stringify(data));
      assert.ok(r.body.data.error_message, JSON.stringify(data));
    }
  });

  it("custom amount: valid -> OFFERS; invalid -> CUSTOM_AMOUNT with the exact error", async () => {
    const t = await setup();
    const token = t.start();
    const custom = await t.exchange(token, "ITEM", { amount: "custom", quantity: "2" });
    assert.equal(custom.body.screen, "CUSTOM_AMOUNT");
    assert.equal(custom.body.data.helper_text, "Between ₹100 and ₹10,000 in steps of ₹50");

    for (const bad of ["125", "50", "10050", "abc", "", "100.5", "-100"]) {
      const r = await t.exchange(token, "CUSTOM_AMOUNT", { custom_amount: bad });
      assert.equal(r.body.screen, "CUSTOM_AMOUNT", bad);
      assert.equal(r.body.data.error_message, "Enter an amount between ₹100 and ₹10,000 in steps of ₹50", bad);
    }
    const ok = await t.exchange(token, "CUSTOM_AMOUNT", { custom_amount: "650" });
    assert.equal(ok.body.screen, "OFFERS");
    // 650 x 2 = 1300 subtotal: GIFT50 now eligible
    assert.equal(ok.body.data.offers.find((o: any) => o.id === "GIFT50").enabled, true);
  });

  it("promo: valid typed code -> REVIEW with the discount; bad codes stay on OFFERS with the reason", async () => {
    const t = await setup();
    const token = t.start();
    await t.exchange(token, "ITEM", { amount: "250", quantity: "1" });

    const cases: [Record<string, string>, RegExp][] = [
      [{ offer: "none", promo_code: "FREE100" }, /FREE100 is not a valid promo code/],
      [{ offer: "none", promo_code: "TRAVEL15" }, /can't be used for Sample brand A/],
      [{ offer: "none", promo_code: "gift50" }, /Add ₹250 more to use GIFT50/],
      [{ offer: "GIFT50", promo_code: "" }, /Add ₹250 more/], // a disabled offer submitted anyway
    ];
    for (const [data, error] of cases) {
      const r = await t.exchange(token, "OFFERS", data);
      assert.equal(r.body.screen, "OFFERS", JSON.stringify(data));
      assert.match(r.body.data.error_message, error);
    }

    const r = await t.exchange(token, "OFFERS", { offer: "none", promo_code: " welcome10 " });
    assert.equal(r.body.screen, "REVIEW");
    assert.deepEqual(r.body.data, {
      brand_line: "Brand: Sample brand A",
      amount_line: "Amount: ₹250 each",
      quantity_line: "Quantity: 1",
      offer_line: "Offer: WELCOME10 (-₹25)",
      total_line: "Total: ₹225",
    });
  });

  it("offer chosen from the radio list (no typed code)", async () => {
    const t = await setup();
    const token = t.start();
    await t.exchange(token, "ITEM", { amount: "2000", quantity: "1" });
    const r = await t.exchange(token, "OFFERS", { offer: "TREAT5" });
    assert.equal(r.body.data.offer_line, "Offer: TREAT5 (-₹75)");
    assert.equal(r.body.data.total_line, "Total: ₹1,925");
  });

  it("promoField off: field hidden and any typed code ignored", async () => {
    const t = await setup({ offersScreen: true, promoField: false });
    const token = t.start();
    const offers = await t.exchange(token, "ITEM", { amount: "500", quantity: "1" });
    assert.equal(offers.body.data.show_promo, false);
    const r = await t.exchange(token, "OFFERS", { offer: "none", promo_code: "FREE100" });
    assert.equal(r.body.screen, "REVIEW");
    assert.equal(r.body.data.offer_line, "Offer: none");
  });

  it("offersScreen off: ITEM and CUSTOM_AMOUNT go straight to REVIEW", async () => {
    const t = await setup({ offersScreen: false, promoField: true });
    const a = t.start();
    assert.equal((await t.exchange(a, "ITEM", { amount: "500", quantity: "3" })).body.screen, "REVIEW");
    const b = t.start();
    await t.exchange(b, "ITEM", { amount: "custom", quantity: "1" });
    const r = await t.exchange(b, "CUSTOM_AMOUNT", { custom_amount: "700" });
    assert.equal(r.body.screen, "REVIEW");
    assert.equal(r.body.data.total_line, "Total: ₹700");
  });

  it("REVIEW confirm -> SUCCESS with flow_token + order_ref; order created; token then dead (427)", async () => {
    const t = await setup();
    const token = t.start();
    await t.exchange(token, "ITEM", { amount: "1000", quantity: "2" });
    await t.exchange(token, "OFFERS", { offer: "GIFT50" });
    const r = await t.exchange(token, "REVIEW", { confirmed: "yes" });
    assert.equal(r.body.screen, "SUCCESS");
    const params = r.body.data.extension_message_response.params;
    assert.equal(params.flow_token, token);
    const order = t.orders.get(params.order_ref)!;
    assert.equal(order.status, "pending_payment");
    assert.equal(order.userId, USER);
    assert.deepEqual(order.price, { subtotal: 2000, discount: 50, total: 1950, pointsUsed: 0, onlineDue: 1950 });
    assert.equal((await t.exchange(token, "REVIEW", { confirmed: "yes" })).status, 427);
  });

  it("OTHER_AMOUNT (catalog path): INIT lists every brand with its range", async () => {
    const t = await setup();
    const r = await t.init(t.startOther());
    assert.equal(r.body.screen, "OTHER_AMOUNT");
    assert.deepEqual(r.body.data.brands.map((b: any) => b.id), ["brand_a", "brand_b", "brand_c", "brand_d"]);
    assert.equal(r.body.data.brands[2].description, "Between ₹250 and ₹10,000 in steps of ₹250");
  });

  it("OTHER_AMOUNT validates the amount against the CHOSEN brand's min/max/step", async () => {
    const t = await setup();
    const token = t.startOther();
    const noBrand = await t.exchange(token, "OTHER_AMOUNT", { custom_amount: "500" });
    assert.equal(noBrand.body.screen, "OTHER_AMOUNT");
    assert.equal(noBrand.body.data.error_message, "Choose a brand");
    const badStep = await t.exchange(token, "OTHER_AMOUNT", { brand: "brand_c", custom_amount: "300" }); // fine for A, not for C
    assert.equal(badStep.body.data.error_message, "Enter an amount between ₹250 and ₹10,000 in steps of ₹250");
    const tooBig = await t.exchange(token, "OTHER_AMOUNT", { brand: "brand_d", custom_amount: "6000" });
    assert.equal(tooBig.body.data.error_message, "Enter an amount between ₹100 and ₹5,000 in steps of ₹50");
    // A brand-dependent screen submitted before a brand exists re-shows the picker.
    assert.equal((await t.exchange(token, "OFFERS", { offer: "none" })).body.screen, "OTHER_AMOUNT");

    const ok = await t.exchange(token, "OTHER_AMOUNT", { brand: "brand_c", custom_amount: "750" });
    assert.equal(ok.body.screen, "OFFERS");
    const review = await t.exchange(token, "OFFERS", { offer: "none" });
    assert.equal(review.body.data.brand_line, "Brand: Sample brand C");
    assert.equal(review.body.data.total_line, "Total: ₹750");
    const done = await t.exchange(token, "REVIEW", { confirmed: "yes" });
    const order = t.orders.get(done.body.data.extension_message_response.params.order_ref)!;
    assert.deepEqual([order.brandId, order.amount, order.qty], ["brand_c", 750, 1]);
  });

  it("customAmount off: no 'Other amount' preset, and 'custom' is rejected", async () => {
    const t = await setup({ customAmount: false });
    const token = t.start();
    const r = await t.init(token);
    assert.ok(!r.body.data.presets.some((p: any) => p.id === "custom"));
    const rejected = await t.exchange(token, "ITEM", { amount: "custom", quantity: "1" });
    assert.equal(rejected.body.screen, "ITEM");
    assert.equal(rejected.body.data.error_message, "Choose an amount");
  });

  it("maxQty: quantities 1..maxQty, more is rejected", async () => {
    const t = await setup({ maxQty: 3 });
    const token = t.start();
    assert.deepEqual((await t.init(token)).body.data.quantities.map((q: any) => q.id), ["1", "2", "3"]);
    const r = await t.exchange(token, "ITEM", { amount: "500", quantity: "4" });
    assert.equal(r.body.data.error_message, "Choose a quantity from 1 to 3");
  });

  it("each session keeps the flags it started with (snapshot), whatever other sessions use", async () => {
    const t = await setup({ offersScreen: true });
    const early = t.start();
    const late = m.sessions.flowTokenFor(t.sessions.create({ userId: USER, brandId: "brand_a", options: { ...t.options, offersScreen: false } }));
    assert.equal((await t.exchange(early, "ITEM", { amount: "500", quantity: "1" })).body.screen, "OFFERS");
    assert.equal((await t.exchange(late, "ITEM", { amount: "500", quantity: "1" })).body.screen, "REVIEW");
  });

  it("BACK re-renders the requested screen; error notifications are acknowledged", async () => {
    const t = await setup();
    const token = t.start();
    await t.exchange(token, "ITEM", { amount: "500", quantity: "1" });
    const back = await t.call({ version: "3.0", action: "BACK", screen: "ITEM", flow_token: token });
    assert.equal(back.body.screen, "ITEM");
    const ack = await t.call({ version: "3.0", action: "data_exchange", screen: "OFFERS", flow_token: "demo:gone", data: { error: "invalid-screen-data", error_message: "x" } });
    assert.deepEqual(ack.body, { data: { acknowledged: true } });
  });
});
