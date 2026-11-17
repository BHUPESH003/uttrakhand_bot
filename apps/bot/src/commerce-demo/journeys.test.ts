/**
 * Commerce demo journeys J1-J6, end to end: simulated Meta webhooks go into
 * the real Fastify app (POST /webhook); every Graph API call the bot makes
 * is captured by a stubbed fetch, so each asserted message went through the
 * real WhatsAppClient — validators and the demo send guard included.
 *
 * Needs local Postgres (sessions + message history), like engine.test.ts:
 *   docker compose up -d && pnpm --filter db migrate:deploy
 *   pnpm --filter bot test:integration
 * DATABASE_URL is forced to TEST_DATABASE_URL or the local docker DB —
 * never whatever apps/bot/.env points at.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

const ALICE = "910000000101"; // allowlisted
const BOB = "910000000102"; // allowlisted
const ASHA = "910000000103"; // allowlisted, Hindi
const CARLA = "910000000104"; // allowlisted, catalog path
const BLOCKED = "910000000199"; // not allowlisted
const USERS = [ALICE, BOB, ASHA, CARLA, BLOCKED];
const CATALOG_ID = "cat-123";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://uttarakhand_bot:uttarakhand_bot@localhost:5432/uttarakhand_bot?schema=public";
Object.assign(process.env, {
  WHATSAPP_TOKEN: "test-token",
  PHONE_NUMBER_ID: "test-phone-id",
  VERIFY_TOKEN: "test-verify",
  WEB_FORM_URL: "https://example.com/form",
  BANNER_IMAGE_URL: "https://example.com/banner.png",
  INTERNAL_API_SECRET: "test-internal",
  AI_SERVICE_URL: "https://example.com/ai",
  AI_SERVICE_TOKEN: "test-ai",
  DEMO_DATASET: "neutral",
  DEMO_SEND_ENABLED: "true",
  DEMO_ALLOWED_RECIPIENTS: [ALICE, BOB, ASHA, CARLA].join(","),
  // Catalog path starts OFF; its own describe below switches config at runtime.
  COMMERCE_CATALOG_ENABLED: "false",
  COMMERCE_CATALOG_ID: CATALOG_ID,
  COMMERCE_FLOW_ID: "flow-123",
  COMMERCE_FLOW_MODE: "draft",
  // Flow flags file in a fresh temp dir, never the developer's .demo-data.
  DEMO_DATA_DIR: mkdtempSync(join(tmpdir(), "demo-data-")),
  // Set (empty) so apps/bot/.env can't fill them in.
  WA_PAYMENT_CONFIG_NAME: "",
  FLOW_PRIVATE_KEY: "",
  META_APP_SECRET: "",
});

// ---- Graph API stub: records every message the bot sends ----
type Sent = { to: string; type: string; [k: string]: any };
const sent: Sent[] = [];
let wamidSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  if (!String(url).startsWith("https://graph.facebook.com/")) throw new Error(`unexpected fetch ${url}`);
  const body = JSON.parse(String(init?.body));
  if (body.status === "read") return Response.json({ success: true }); // markAsRead
  sent.push(body);
  return Response.json({ messages: [{ id: `wamid.out.${++wamidSeq}` }] });
}) as typeof fetch;

let app: FastifyInstance;
let m: {
  webhookIdle: () => Promise<void>;
  prisma: typeof import("db").prisma;
  handleFlowRequest: typeof import("./flowHandler").handleFlowRequest;
  flowDeps: import("./flowHandler").FlowDeps;
  pointsLedger: import("./data/points").PointsLedger;
  config: typeof import("../config").config;
};

before(async () => {
  const { buildServer } = await import("../server.js");
  const { webhookIdle } = await import("../routes/webhook.js");
  const { prisma } = await import("db");
  const { handleFlowRequest } = await import("./flowHandler.js");
  const { commerceSessions } = await import("./sessions.js");
  const data = await import("./data/index.js");
  const { config } = await import("../config.js");
  m = {
    webhookIdle,
    prisma,
    handleFlowRequest,
    flowDeps: { sessions: commerceSessions, dataset: data.dataset, orders: data.orderStore },
    pointsLedger: data.pointsLedger,
    config,
  };
  await prisma.session.deleteMany({ where: { userId: { in: USERS } } });
  await prisma.messageLog.deleteMany({ where: { mobileNumber: { in: USERS } } });
  app = buildServer();
  app.log.level = "silent";
  await app.ready();
});

after(async () => {
  await app.close();
  await m.prisma.$disconnect();
  globalThis.fetch = realFetch;
});

// ---- webhook builders ----
let inSeq = 0;
const newId = () => `wamid.in.${Date.now()}.${++inSeq}`;
const envelope = (value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550000000", phone_number_id: "test-phone-id" }, ...value } }] }],
});
const msg = (from: string, fields: Record<string, unknown>, id = newId()) =>
  envelope({ contacts: [{ profile: { name: "Tester" }, wa_id: from }], messages: [{ from, id, timestamp: "0", ...fields }] });
const text = (from: string, body: string) => msg(from, { type: "text", text: { body } });
const button = (from: string, id: string) => msg(from, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: id } } });
const listReply = (from: string, id: string) => msg(from, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: id } } });
const cart = (from: string, catalogId: string, items: [string, number, number?][]) =>
  msg(from, {
    type: "order",
    order: {
      catalog_id: catalogId,
      text: "",
      product_items: items.map(([id, quantity, price]) => ({ product_retailer_id: id, quantity, item_price: price ?? 0, currency: "INR" })),
    },
  });
const nfm = (from: string, response: object, id?: string) =>
  msg(from, { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify(response) } } }, id);

/** Posts a webhook, waits for processing, returns what the bot sent to `user`. */
async function send(user: string, body: object): Promise<Sent[]> {
  const from = sent.length;
  const res = await app.inject({ method: "POST", url: "/webhook", payload: body });
  assert.equal(res.statusCode, 200);
  await m.webhookIdle();
  return sent.slice(from).filter((s) => s.to === user);
}

const buttonIds = (s: Sent) => s.interactive.action.buttons.map((b: any) => b.reply.id);
const buttonTitles = (s: Sent) => s.interactive.action.buttons.map((b: any) => b.reply.title);
const rowIds = (s: Sent) => s.interactive.action.sections.flatMap((x: any) => x.rows.map((r: any) => r.id));
const bodyOf = (s: Sent) => (s.type === "text" ? s.text.body : s.interactive.body.text);

async function onboard(user: string, lang: "lang_en" | "lang_hi" = "lang_en") {
  await send(user, text(user, "hi"));
  await send(user, button(user, "proceed"));
  return send(user, button(user, lang)); // MAIN_MENU: buttons + "More options" list
}

/** Opens the Flow for `brandId` and completes it through the real Flow handler; returns the nfm_reply response_json. */
async function buyViaFlow(user: string, brandId: string, amount: string, quantity: string, offer = "none") {
  const [flowMsg] = await send(user, button(user, `view:${brandId}`));
  const token = flowMsg!.interactive.action.parameters.flow_token;
  const step = (screen: string, data: Record<string, unknown>) =>
    m.handleFlowRequest({ version: "3.0", action: "data_exchange", screen, data, flow_token: token }, m.flowDeps);
  assert.equal((step("ITEM", { amount, quantity }) as any).body.screen, "OFFERS");
  assert.equal((step("OFFERS", { offer }) as any).body.screen, "REVIEW");
  const done = step("REVIEW", { confirmed: "yes" }) as any;
  assert.equal(done.body.screen, "SUCCESS");
  return done.body.data.extension_message_response.params as { flow_token: string; order_ref: string };
}

describe("commerce demo journeys (webhook -> Fastify -> Graph API)", () => {
  it("menu entry is shown only to allowlisted numbers", async () => {
    const aliceMenu = await onboard(ALICE);
    assert.ok(rowIds(aliceMenu.at(-1)!).includes("menu_commerce"));
    const blockedMenu = await onboard(BLOCKED);
    assert.ok(!rowIds(blockedMenu.at(-1)!).includes("menu_commerce"));
  });

  it("guard: a blocked recipient gets nothing from the demo, even with crafted taps", async () => {
    for (const body of [listReply(BLOCKED, "menu_commerce"), button(BLOCKED, "c:buy"), button(BLOCKED, "view:brand_a"), button(BLOCKED, "c:balance")]) {
      assert.deepEqual(await send(BLOCKED, body), []);
    }
  });

  it("J1: Commerce demo opens a menu with Buy / Track order / Check balance", async () => {
    const out = await send(ALICE, listReply(ALICE, "menu_commerce"));
    assert.equal(out.length, 2);
    assert.deepEqual(buttonIds(out[0]!), ["c:buy", "c:track", "c:balance"]);
    assert.deepEqual(buttonTitles(out[0]!), ["Buy", "Track order", "Check balance"]);
    assert.match(bodyOf(out[0]!), /Commerce demo/);
    assert.deepEqual(buttonIds(out[1]!), ["back_to_menu"]);
  });

  it("J5: Check balance shows the demo points balance", async () => {
    const [out] = await send(ALICE, button(ALICE, "c:balance"));
    assert.match(bodyOf(out!), /Demo points balance: 2,500/);
  });

  it("J4: Track order with no orders yet", async () => {
    const [out] = await send(ALICE, button(ALICE, "c:track"));
    assert.match(bodyOf(out!), /no demo orders yet/);
  });

  it("J2: Buy sends a brand carousel; choosing a card sends the Flow button opening ITEM", async () => {
    const buy = await send(ALICE, button(ALICE, "c:buy"));
    assert.equal(buy.length, 1, "catalog off: no 'Browse catalog' follow-up");
    const [carousel] = buy;
    assert.equal(carousel!.interactive.type, "carousel");
    assert.ok(carousel!.interactive.action.cards.every((c: any) => c.action.buttons.length === 1), "catalog off: no 'View product'");
    const cards = carousel!.interactive.action.cards;
    assert.equal(cards.length, 4);
    assert.deepEqual(cards.map((c: any) => c.action.buttons[0].quick_reply.id), ["view:brand_a", "view:brand_b", "view:brand_c", "view:brand_d"]);
    assert.match(cards[0].header.image.link, /^https:\/\/.+\.png/);

    const [flow] = await send(ALICE, button(ALICE, "view:brand_b"));
    const p = flow!.interactive.action.parameters;
    assert.equal(flow!.interactive.type, "flow");
    assert.equal(p.flow_id, "flow-123");
    assert.equal(p.flow_cta, "Choose amount");
    assert.equal(p.mode, "draft");
    assert.equal(p.flow_action, "navigate");
    assert.match(p.flow_token, /^demo:/);
    assert.equal(p.flow_action_payload.screen, "ITEM");
    const data = JSON.parse(p.flow_action_payload.data);
    assert.equal(data.brand_name, "Sample brand B");
    assert.equal(data.presets.at(-1).id, "custom");
  });

  it("J2: a template-style quick-reply tap (type 'button') routes the same way", async () => {
    const out = await send(ALICE, msg(ALICE, { type: "button", button: { payload: "view:brand_a", text: "Select" } }));
    assert.equal(out[0]!.interactive.type, "flow");
  });

  let paidOrder = "";
  it("J3: Flow completion -> summary -> Pay (demo) -> OTP -> code in monospace", async () => {
    const response = await buyViaFlow(ALICE, "brand_a", "500", "2");
    const nfmId = newId();
    const [summary] = await send(ALICE, nfm(ALICE, response, nfmId));
    paidOrder = response.order_ref;
    assert.match(bodyOf(summary!), new RegExp(`Order ${paidOrder}`));
    assert.match(bodyOf(summary!), /₹500 × 2 = ₹1,000/);
    assert.match(bodyOf(summary!), /Total: ₹1,000/);
    assert.match(bodyOf(summary!), /Paid with points: 1,000/);
    assert.match(bodyOf(summary!), /Pay online: ₹0/);
    assert.deepEqual(buttonIds(summary!), [`pay:${paidOrder}`, `cancel:${paidOrder}`]);
    assert.deepEqual(buttonTitles(summary!), ["Pay (demo)", "Cancel order"]);

    // Meta redelivers the same webhook: deduped, nothing sent.
    assert.deepEqual(await send(ALICE, nfm(ALICE, response, nfmId)), []);

    const [otp] = await send(ALICE, button(ALICE, `pay:${paidOrder}`));
    assert.match(bodyOf(otp!), /1,000 points/);
    assert.match(bodyOf(otp!), /OTP \*123456\*/);

    const [wrong] = await send(ALICE, text(ALICE, "000000"));
    assert.match(bodyOf(wrong!), /not correct/);

    const delivered = await send(ALICE, text(ALICE, "123456"));
    assert.equal(delivered.length, 2);
    const codes = bodyOf(delivered[0]!).match(/```DEMO-ITEM-[A-Z2-9]{4}-[A-Z2-9]{4}```/g);
    assert.equal(codes?.length, 2);
    assert.deepEqual(buttonIds(delivered[1]!), ["c:buy", "c:track"]);
    assert.deepEqual(buttonTitles(delivered[1]!), ["Buy another", "Track order"]);

    const [balance] = await send(ALICE, button(ALICE, "c:balance"));
    assert.match(bodyOf(balance!), /1,500/);

    // Tapping Pay again on the old message: no second charge.
    const [again] = await send(ALICE, button(ALICE, `pay:${paidOrder}`));
    assert.match(bodyOf(again!), /already delivered/);
  });

  let cancelledOrder = "";
  it("J3: Cancel order releases points held by an unfinished payment", async () => {
    const response = await buyViaFlow(ALICE, "brand_d", "250", "1");
    cancelledOrder = response.order_ref;
    await send(ALICE, nfm(ALICE, response));
    await send(ALICE, button(ALICE, `pay:${cancelledOrder}`)); // holds 250 points, asks OTP
    assert.equal(m.pointsLedger.available(ALICE), 1250);
    const [cancelled] = await send(ALICE, button(ALICE, `cancel:${cancelledOrder}`));
    assert.match(bodyOf(cancelled!), /has been cancelled/);
    assert.equal(m.pointsLedger.available(ALICE), 1500);
    const [again] = await send(ALICE, button(ALICE, `cancel:${cancelledOrder}`));
    assert.match(bodyOf(again!), /can't be cancelled/);
    // The OTP for the cancelled payment no longer does anything but help.
    const [help] = await send(ALICE, text(ALICE, "123456"));
    assert.match(bodyOf(help!), /type \*menu\*/);
  });

  let failedOrder = "";
  it("J3: quantity 7 -> paid, issuance fails, points refunded", async () => {
    const response = await buyViaFlow(ALICE, "brand_a", "250", "7"); // 1,750: 1,500 points + ₹250 online
    failedOrder = response.order_ref;
    const [summary] = await send(ALICE, nfm(ALICE, response));
    assert.match(bodyOf(summary!), /Paid with points: 1,500/);
    assert.match(bodyOf(summary!), /Pay online: ₹250/);
    await send(ALICE, button(ALICE, `pay:${failedOrder}`));
    const [failed] = await send(ALICE, text(ALICE, "123456"));
    assert.match(bodyOf(failed!), /couldn't issue your code/);
    assert.equal(m.pointsLedger.available(ALICE), 1500);
  });

  it("J3: with no points left there is no OTP; quantity 9 duplicate payment event delivers once", async () => {
    // Spend all 2,500 of Bob's points first (OTP path).
    await onboard(BOB);
    const drain = await buyViaFlow(BOB, "brand_b", "500", "5");
    await send(BOB, nfm(BOB, drain));
    await send(BOB, button(BOB, `pay:${drain.order_ref}`));
    await send(BOB, text(BOB, "123456"));
    assert.equal(m.pointsLedger.available(BOB), 0);

    const response = await buyViaFlow(BOB, "brand_b", "250", "9");
    const [summary] = await send(BOB, nfm(BOB, response));
    assert.match(bodyOf(summary!), /Pay online: ₹2,250/);
    const out = await send(BOB, button(BOB, `pay:${response.order_ref}`));
    assert.equal(out.length, 2, "one delivery message + buttons, no OTP");
    assert.equal(bodyOf(out[0]!).match(/```DEMO-ITEM-/g)?.length, 9);
  });

  it("J4: Track order lists recent orders; choosing one shows status steps and the code", async () => {
    const [list] = await send(ALICE, button(ALICE, "c:track"));
    assert.equal(list!.interactive.type, "list");
    assert.deepEqual(rowIds(list!), [`order:${failedOrder}`, `order:${cancelledOrder}`, `order:${paidOrder}`]);
    const descriptions = list!.interactive.action.sections[0].rows.map((r: any) => r.description);
    assert.match(descriptions[0], /failed$/);
    assert.match(descriptions[1], /cancelled$/);
    assert.match(descriptions[2], /Sample brand A · ₹1,000 · delivered$/);

    const [status, next] = await send(ALICE, listReply(ALICE, `order:${paidOrder}`));
    assert.match(bodyOf(status!), /✅ Order placed\n✅ Paid\n✅ Code delivered/);
    assert.match(bodyOf(status!), /```DEMO-ITEM-/);
    assert.deepEqual(buttonIds(next!), ["c:buy", "c:track", "c:balance"]);

    const [cancelled] = await send(ALICE, listReply(ALICE, `order:${cancelledOrder}`));
    assert.match(bodyOf(cancelled!), /❌ Cancelled/);
    assert.doesNotMatch(bodyOf(cancelled!), /```/);
  });

  it("J4: someone else's order id is not found", async () => {
    const bobOrder = (await m.flowDeps.orders.listForUser(BOB))[0]!.id;
    const [out] = await send(ALICE, listReply(ALICE, `order:${bobOrder}`));
    assert.match(bodyOf(out!), /couldn't find that order/);
  });

  it("J6: 'menu' and 'hi' return to the demo menu; unknown text gets a short help", async () => {
    const [menu] = await send(ALICE, text(ALICE, "menu"));
    assert.deepEqual(buttonIds(menu!), ["c:buy", "c:track", "c:balance"]);
    const [hi] = await send(ALICE, text(ALICE, "Hi!"));
    assert.deepEqual(buttonIds(hi!), ["c:buy", "c:track", "c:balance"]);
    const help = await send(ALICE, text(ALICE, "what is this"));
    assert.equal(help.length, 1);
    assert.match(bodyOf(help[0]!), /type \*menu\*/);
  });

  it("J6: outside the demo, 'hi' keeps its existing behaviour (restart at language)", async () => {
    await send(ALICE, button(ALICE, "back_to_menu"));
    const out = await send(ALICE, text(ALICE, "hi"));
    assert.deepEqual(buttonIds(out[0]!), ["lang_en", "lang_hi"]);
  });

  it("Hindi: the demo copy passes every validator (button/row lengths) in Hindi", async () => {
    const menu = await onboard(ASHA, "lang_hi");
    const [demoMenu] = await send(ASHA, listReply(ASHA, "menu_commerce"));
    assert.deepEqual(buttonTitles(demoMenu!), ["खरीदें", "ऑर्डर ट्रैक करें", "बैलेंस देखें"]);
    assert.ok(rowIds(menu.at(-1)!).includes("menu_commerce"));
    const [carousel] = await send(ASHA, button(ASHA, "c:buy"));
    assert.equal(carousel!.interactive.action.cards[0].action.buttons[0].quick_reply.title, "चुनें");
    const response = await buyViaFlow(ASHA, "brand_c", "1000", "1", "TRAVEL15");
    const [summary] = await send(ASHA, nfm(ASHA, response));
    assert.match(bodyOf(summary!), /ऑफ़र TRAVEL15: -₹150/);
    assert.deepEqual(buttonTitles(summary!), ["भुगतान (डेमो)", "ऑर्डर रद्द करें"]);
    await send(ASHA, button(ASHA, `pay:${response.order_ref}`));
    const delivered = await send(ASHA, text(ASHA, "123456"));
    assert.deepEqual(buttonTitles(delivered[1]!), ["फिर से खरीदें", "ऑर्डर ट्रैक करें"]);
    const [list] = await send(ASHA, button(ASHA, "c:track"));
    assert.equal(list!.interactive.action.button, "ऑर्डर देखें");
  });

  it("catalog off: catalog buttons and carts are ignored (help only)", async () => {
    await send(ALICE, button(ALICE, "lang_en")); // the J6 test left her on language selection
    await send(ALICE, listReply(ALICE, "menu_commerce"));
    for (const body of [button(ALICE, "c:catalog"), button(ALICE, "c:other"), button(ALICE, "product:brand_a"), cart(ALICE, CATALOG_ID, [["demo-a-500", 1, 500]])]) {
      const out = await send(ALICE, body);
      assert.equal(out.length, 1);
      assert.match(bodyOf(out[0]!), /type \*menu\*/);
    }
  });

  it("history: incoming messages are logged once; statuses are logged with error codes and deduped", async () => {
    const incoming = await m.prisma.messageLog.count({ where: { mobileNumber: ALICE, direction: "INCOMING", type: "flow_reply" } });
    assert.equal(incoming, 3, "3 completed Flows, the redelivered one not logged twice");

    const status = (s: string, extra: object = {}) => ({ id: "wamid.out.status-test", status: s, timestamp: "0", recipient_id: ALICE, ...extra });
    const statuses = [
      status("sent"),
      status("delivered"),
      status("read"),
      status("failed", { errors: [{ code: 131049, title: "ecosystem", message: "ecosystem" }] }),
    ];
    await send(ALICE, envelope({ statuses }));
    await send(ALICE, envelope({ statuses })); // redelivered
    const rows = await m.prisma.messageLog.findMany({ where: { waMessageId: "wamid.out.status-test" }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(rows.map((r) => r.status), ["sent", "delivered", "read", "failed"]);
    assert.deepEqual((rows[3]!.payload as any).errorCodes, [131049]);
    const { listMessagesForNumber } = await import("db");
    assert.ok((await listMessagesForNumber(ALICE)).every((r) => r.type !== "status"), "receipts stay out of the transcript");
  });

  describe("catalog path (COMMERCE_CATALOG_ENABLED)", () => {
    before(async () => {
      m.config.COMMERCE_CATALOG_ENABLED = true;
      await onboard(CARLA);
      await send(CARLA, listReply(CARLA, "menu_commerce"));
    });
    after(() => {
      m.config.COMMERCE_CATALOG_ENABLED = false;
    });

    it("Buy: each card also offers 'View product', then a 'Browse catalog' button", async () => {
      const [carousel, prompt] = await send(CARLA, button(CARLA, "c:buy"));
      const card = carousel!.interactive.action.cards[2];
      assert.deepEqual(card.action.buttons.map((b: any) => [b.quick_reply.id, b.quick_reply.title]), [
        ["view:brand_c", "Select"],
        ["product:brand_c", "View product"],
      ]);
      assert.deepEqual(buttonIds(prompt!), ["c:catalog"]);
      assert.deepEqual(buttonTitles(prompt!), ["Browse catalog"]);
    });

    it("single-product message for a card's brand at its featured preset", async () => {
      const [product] = await send(CARLA, button(CARLA, "product:brand_c"));
      assert.equal(product!.interactive.type, "product");
      assert.deepEqual(product!.interactive.action, { catalog_id: CATALOG_ID, product_retailer_id: "demo-c-500" });
      assert.equal(product!.interactive.header, undefined);
    });

    it("Browse catalog: one section per brand (max 10 / 30 items), then 'Other amount'", async () => {
      const [list, other] = await send(CARLA, button(CARLA, "c:catalog"));
      const i = list!.interactive;
      assert.equal(i.type, "product_list");
      assert.equal(i.action.catalog_id, CATALOG_ID);
      assert.deepEqual(i.header, { type: "text", text: "Sample catalog" });
      assert.deepEqual(i.action.sections.map((x: any) => x.title), ["Sample brand A", "Sample brand B", "Sample brand C", "Sample brand D"]);
      const items = i.action.sections.flatMap((x: any) => x.product_items.map((p: any) => p.product_retailer_id));
      assert.equal(items.length, 20);
      assert.ok(i.action.sections.length <= 10 && items.length <= 30);
      assert.deepEqual(i.action.sections[1].product_items[0], { product_retailer_id: "demo-b-250" });
      assert.deepEqual(buttonIds(other!), ["c:other"]);
      assert.deepEqual(buttonTitles(other!), ["Other amount"]);
    });

    let otherToken = "";
    it("'Other amount' opens the Flow on OTHER_AMOUNT (navigate) with the brand choices", async () => {
      const [flow] = await send(CARLA, button(CARLA, "c:other"));
      const p = flow!.interactive.action.parameters;
      assert.equal(p.flow_action, "navigate");
      assert.equal(p.flow_cta, "Other amount");
      assert.equal(p.flow_action_payload.screen, "OTHER_AMOUNT");
      const data = JSON.parse(p.flow_action_payload.data);
      assert.deepEqual(data.brands.map((b: any) => b.id), ["brand_a", "brand_b", "brand_c", "brand_d"]);
      assert.equal(data.brands[0].description, "Between ₹100 and ₹10,000 in steps of ₹50");
      assert.match(p.flow_token, /^demo:/);
      otherToken = p.flow_token;
    });

    let customOrder = "";
    it("custom amount order: validated against the brand, then the same J3 summary, payment and delivery", async () => {
      const step = (screen: string, data: Record<string, unknown>) =>
        m.handleFlowRequest({ version: "3.0", action: "data_exchange", screen, data, flow_token: otherToken }, m.flowDeps) as any;
      assert.equal(step("OTHER_AMOUNT", { brand: "brand_c", custom_amount: "300" }).body.data.error_message, "Enter an amount between ₹250 and ₹10,000 in steps of ₹250");
      assert.equal(step("OTHER_AMOUNT", { brand: "brand_c", custom_amount: "750" }).body.screen, "OFFERS");
      assert.equal(step("OFFERS", { offer: "none" }).body.screen, "REVIEW");
      const done = step("REVIEW", { confirmed: "yes" });
      const response = done.body.data.extension_message_response.params;
      customOrder = response.order_ref;

      const [summary] = await send(CARLA, nfm(CARLA, response));
      assert.match(bodyOf(summary!), /Sample brand C · Sample gift item\n₹750 × 1 = ₹750/);
      assert.match(bodyOf(summary!), /Paid with points: 750/);
      assert.deepEqual(buttonIds(summary!), [`pay:${customOrder}`, `cancel:${customOrder}`]);
      await send(CARLA, button(CARLA, `pay:${customOrder}`));
      const [delivered] = await send(CARLA, text(CARLA, "123456"));
      assert.match(bodyOf(delivered!), /```DEMO-ITEM-[A-Z2-9]{4}-[A-Z2-9]{4}```/);
      assert.equal(m.flowDeps.orders.get(customOrder)!.status, "delivered");
    });

    it("cart webhook: retailer ids map to brand + amount, unknown ids are skipped, then J3", async () => {
      const out = await send(CARLA, cart(CARLA, CATALOG_ID, [["demo-a-500", 2, 500], ["demo-z-999", 1, 10]]));
      assert.equal(out.length, 2);
      assert.match(bodyOf(out[0]!), /skipped: demo-z-999/);
      const summary = out[1]!;
      assert.match(bodyOf(summary), /Sample brand A · Sample gift item\n₹500 × 2 = ₹1,000/);
      const orderId = buttonIds(summary)[0].slice("pay:".length);
      const order = m.flowDeps.orders.get(orderId)!;
      assert.deepEqual([order.userId, order.brandId, order.amount, order.qty, order.promoCode], [CARLA, "brand_a", 500, 2, null]);
      // Same shape as the Flow's custom-amount order: one payment path for all.
      assert.deepEqual(Object.keys(order).sort(), Object.keys(m.flowDeps.orders.get(customOrder)!).sort());

      await send(CARLA, button(CARLA, `pay:${orderId}`)); // 1,000 of Carla's remaining 1,750 points -> OTP
      const [delivered, next] = await send(CARLA, text(CARLA, "123456"));
      assert.equal(bodyOf(delivered!).match(/```DEMO-ITEM-/g)?.length, 2);
      assert.deepEqual(buttonIds(next!), ["c:buy", "c:track"]);
    });

    it("cart with several valid lines -> one order + summary per line", async () => {
      const out = await send(CARLA, cart(CARLA, CATALOG_ID, [["demo-b-250", 1, 250], ["demo-d-1000", 3, 1000]]));
      assert.equal(out.length, 2);
      assert.match(bodyOf(out[0]!), /₹250 × 1 = ₹250/);
      assert.match(bodyOf(out[1]!), /Sample brand D · Sample gift item\n₹1,000 × 3 = ₹3,000/);
    });

    it("cart that maps to nothing (unknown ids, wrong catalog, bad quantity) creates no order", async () => {
      const before = m.flowDeps.orders.listForUser(CARLA).length;
      for (const body of [
        cart(CARLA, CATALOG_ID, [["demo-a-501", 1, 501]]),
        cart(CARLA, "some-other-catalog", [["demo-a-500", 1, 500]]),
        cart(CARLA, CATALOG_ID, [["demo-a-500", 0, 500], ["demo-a-500", 11, 500]]),
      ]) {
        const [skipped, empty] = await send(CARLA, body);
        assert.match(bodyOf(skipped!), /skipped/);
        assert.match(bodyOf(empty!), /None of the items in your cart could be ordered/);
        assert.deepEqual(buttonIds(empty!), ["c:buy", "c:track", "c:balance"]);
      }
      assert.equal(m.flowDeps.orders.listForUser(CARLA).length, before);
    });

    it("cart price from Meta is not trusted: the order is priced from our data", async () => {
      const [summary] = await send(CARLA, cart(CARLA, CATALOG_ID, [["demo-c-1000", 1, 1]]));
      assert.match(bodyOf(summary!), /Total: ₹1,000/);
    });
  });

  describe("admin flags + internal demo routes", () => {
    const SECRET = "test-internal";
    const internal = (method: "GET" | "PUT" | "POST", url: string, payload?: object, secret = SECRET) =>
      app.inject({ method, url, payload, headers: secret ? { "x-internal-secret": secret } : {} });

    after(async () => {
      await internal("PUT", "/internal/demo-config", { offersScreen: true, promoField: true, customAmount: true, maxQty: 10 });
    });

    it("demo-config: needs the internal secret; validates; round-trips", async () => {
      assert.equal((await internal("GET", "/internal/demo-config", undefined, "wrong")).statusCode, 401);
      assert.equal((await internal("PUT", "/internal/demo-config", { maxQty: 3 }, "")).statusCode, 401);
      const bad = await internal("PUT", "/internal/demo-config", { maxQty: 0, colour: "red" });
      assert.equal(bad.statusCode, 400);
      assert.match(bad.json().error, /maxQty/);
      const ok = await internal("PUT", "/internal/demo-config", { maxQty: 4 });
      assert.deepEqual(ok.json().config, { offersScreen: true, promoField: true, customAmount: true, maxQty: 4 });
      assert.equal((await internal("GET", "/internal/demo-config")).json().config.maxQty, 4);
    });

    it("flags are snapshotted per Flow session: a change mid-Flow doesn't change that customer's screens", async () => {
      await internal("PUT", "/internal/demo-config", { offersScreen: true, customAmount: true, maxQty: 10 });
      const [early] = await send(ALICE, button(ALICE, "view:brand_a"));
      const earlyToken = early!.interactive.action.parameters.flow_token;

      // Admin switches OFFERS and custom amounts off while ALICE's Flow is open.
      await internal("PUT", "/internal/demo-config", { offersScreen: false, customAmount: false, maxQty: 3 });
      const step = (token: string) =>
        m.handleFlowRequest({ version: "3.0", action: "data_exchange", screen: "ITEM", data: { amount: "500", quantity: "1" }, flow_token: token }, m.flowDeps) as any;
      assert.equal(step(earlyToken).body.screen, "OFFERS", "open Flow keeps its snapshot");

      const [late] = await send(ALICE, button(ALICE, "view:brand_a"));
      const data = JSON.parse(late!.interactive.action.parameters.flow_action_payload.data);
      assert.ok(!data.presets.some((p: any) => p.id === "custom"), "new Flow: no Other amount");
      assert.deepEqual(data.quantities.map((q: any) => q.id), ["1", "2", "3"]);
      assert.equal(step(late!.interactive.action.parameters.flow_token).body.screen, "REVIEW", "new Flow skips OFFERS");
    });

    it("customAmount off also hides 'Other amount' next to the catalog", async () => {
      m.config.COMMERCE_CATALOG_ENABLED = true;
      try {
        await internal("PUT", "/internal/demo-config", { customAmount: false });
        assert.equal((await send(CARLA, button(CARLA, "c:catalog"))).length, 1, "product list only");
        await internal("PUT", "/internal/demo-config", { customAmount: true });
        assert.equal((await send(CARLA, button(CARLA, "c:catalog"))).length, 2);
      } finally {
        m.config.COMMERCE_CATALOG_ENABLED = false;
      }
    });

    it("demo/send (used by demo:flow:send): Flow in draft or published mode, through the guard", async () => {
      await internal("PUT", "/internal/demo-config", { offersScreen: true, customAmount: true, maxQty: 10 });
      const before = sent.length;
      const res = await internal("POST", "/internal/demo/send", { to: ALICE, kind: "flow", mode: "published", brandId: "brand_d" });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().to, "********0101");
      const flow = sent.slice(before).find((x) => x.to === ALICE)!;
      assert.equal(flow.interactive.action.parameters.mode, "published");
      assert.equal(JSON.parse(flow.interactive.action.parameters.flow_action_payload.data).brand_name, "Sample brand D");

      const draft = await internal("POST", "/internal/demo/send", { to: ALICE, kind: "flow", mode: "draft", screen: "OTHER_AMOUNT" });
      assert.equal(draft.statusCode, 200);
      assert.equal(sent.at(-1)!.interactive.action.parameters.mode, "draft");
      assert.equal(sent.at(-1)!.interactive.action.parameters.flow_action_payload.screen, "OTHER_AMOUNT");

      const carousel = await internal("POST", "/internal/demo/send", { to: ALICE, kind: "carousel" });
      assert.equal(carousel.statusCode, 200);
      assert.equal(sent.at(-1)!.interactive.type, "carousel");
    });

    it("demo/send: blocked recipient -> 403 and nothing sent; bad input -> 400; no secret -> 401", async () => {
      const before = sent.length;
      const blocked = await internal("POST", "/internal/demo/send", { to: BLOCKED, kind: "flow" });
      assert.equal(blocked.statusCode, 403);
      assert.doesNotMatch(blocked.body, new RegExp(BLOCKED));
      assert.equal(sent.length, before);
      assert.equal((await internal("POST", "/internal/demo/send", { to: "abc", kind: "flow" })).statusCode, 400);
      assert.equal((await internal("POST", "/internal/demo/send", { to: ALICE, kind: "sms" })).statusCode, 400);
      assert.equal((await internal("POST", "/internal/demo/send", { to: ALICE, kind: "flow" }, "")).statusCode, 401);
      assert.equal((await internal("POST", "/internal/demo/send", { to: ALICE, kind: "catalog" })).statusCode, 502, "catalog path off");
    });
  });
});
