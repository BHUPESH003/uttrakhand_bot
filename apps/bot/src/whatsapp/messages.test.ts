/**
 * Validators + builders for every interactive payload, plus the client's
 * send guard and payment gate. No network: the client's `post` seam is
 * faked. Run: pnpm --filter bot test:unit
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCarousel,
  buildFlow,
  buildList,
  buildOrderDetails,
  buildOrderStatus,
  buildProduct,
  buildProductList,
  buildReplyButtons,
  orderTotalPaise,
  PayloadValidationError,
  validateCarousel,
  validateCtaUrl,
  validateFlow,
  validateList,
  validateOrderDetails,
  validateOrderStatus,
  validateProduct,
  validateProductList,
  validateReplyButtons,
  type CarouselInput,
  type FlowInput,
  type ListInput,
  type OrderDetailsInput,
  type ProductListInput,
} from "./messages";

const TO = "919812345678";
const s = (n: number) => "x".repeat(n);
/** Asserts the validator reports exactly one issue matching `pattern`. */
function fails(issues: string[], pattern: RegExp) {
  assert.equal(issues.length, 1, `expected one issue, got: ${JSON.stringify(issues)}`);
  assert.match(issues[0]!, pattern);
}
const interactiveOf = (payload: { interactive: unknown }) => payload.interactive as any;

describe("reply buttons", () => {
  const ok = { body: "Pick one", buttons: [{ id: "a", title: "A" }, { id: "b", title: "B" }] };

  it("passes and builds the documented shape", () => {
    assert.deepEqual(validateReplyButtons(ok), []);
    const p = buildReplyButtons(TO, ok);
    assert.equal(p.type, "interactive");
    assert.deepEqual(interactiveOf(p).action.buttons[0], { type: "reply", reply: { id: "a", title: "A" } });
  });
  it("max 3 buttons, min 1", () => {
    fails(validateReplyButtons({ ...ok, buttons: [1, 2, 3, 4].map((i) => ({ id: `${i}`, title: `${i}` })) }), /buttons: need 1-3, got 4/);
    fails(validateReplyButtons({ ...ok, buttons: [] }), /need 1-3, got 0/);
  });
  it("title max 20", () => {
    assert.deepEqual(validateReplyButtons({ ...ok, buttons: [{ id: "a", title: s(20) }] }), []);
    fails(validateReplyButtons({ ...ok, buttons: [{ id: "a", title: s(21) }] }), /title.*exceeds 20/);
  });
  it("titles and ids unique", () => {
    fails(validateReplyButtons({ ...ok, buttons: [{ id: "a", title: "Same" }, { id: "b", title: "Same" }] }), /titles must be unique/);
    fails(validateReplyButtons({ ...ok, buttons: [{ id: "a", title: "A" }, { id: "a", title: "B" }] }), /ids must be unique/);
  });
  it("body required, max 1024; id max 256", () => {
    fails(validateReplyButtons({ ...ok, body: " " }), /body must not be empty/);
    fails(validateReplyButtons({ ...ok, body: s(1025) }), /body exceeds 1024/);
    fails(validateReplyButtons({ ...ok, buttons: [{ id: s(257), title: "A" }] }), /id.*exceeds 256/);
  });
  it("builder throws PayloadValidationError listing every issue", () => {
    assert.throws(
      () => buildReplyButtons(TO, { body: "", buttons: [{ id: "a", title: s(21) }] }),
      (err: unknown) => err instanceof PayloadValidationError && err.issues.length === 2,
    );
  });
  it("counts UTF-16 code units, like Meta (Devanagari + emoji)", () => {
    const hindi = "📝 प्रमाणपत्र आवेदन"; // looks short, is 19 code units
    assert.equal(hindi.length, 19);
    assert.deepEqual(validateReplyButtons({ ...ok, buttons: [{ id: "a", title: hindi }] }), []);
    fails(validateReplyButtons({ ...ok, buttons: [{ id: "a", title: `${hindi}ं✅` }] }), /exceeds 20/);
  });
});

describe("list", () => {
  const ok: ListInput = { body: "Menu", buttonText: "Open", sections: [{ rows: [{ id: "r1", title: "One", description: "d" }] }] };

  it("passes; single untitled section allowed", () => {
    assert.deepEqual(validateList(ok), []);
    assert.equal(interactiveOf(buildList(TO, ok)).action.button, "Open");
  });
  it("max 10 rows total across sections", () => {
    const rows = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, title: `${p}${i}` }));
    assert.deepEqual(validateList({ ...ok, sections: [{ title: "A", rows: rows(5, "a") }, { title: "B", rows: rows(5, "b") }] }), []);
    fails(validateList({ ...ok, sections: [{ title: "A", rows: rows(6, "a") }, { title: "B", rows: rows(5, "b") }] }), /rows across all sections: need 1-10, got 11/);
  });
  it("row title 24, description 72, button 20, section title 24", () => {
    fails(validateList({ ...ok, sections: [{ rows: [{ id: "r", title: s(25) }] }] }), /row title.*exceeds 24/);
    fails(validateList({ ...ok, sections: [{ rows: [{ id: "r", title: "t", description: s(73) }] }] }), /description.*exceeds 72/);
    fails(validateList({ ...ok, buttonText: s(21) }), /list button text exceeds 20/);
    fails(validateList({ ...ok, sections: [{ title: s(25), rows: [{ id: "r", title: "t" }] }] }), /section title exceeds 24/);
  });
  it("body max 4096 (docs), not 1024", () => {
    assert.deepEqual(validateList({ ...ok, body: s(4096) }), []);
    fails(validateList({ ...ok, body: s(4097) }), /body exceeds 4096/);
  });
  it("section titles required with more than one section; row ids unique", () => {
    fails(validateList({ ...ok, sections: [{ title: "A", rows: [{ id: "1", title: "1" }] }, { rows: [{ id: "2", title: "2" }] }] }), /section title is required/);
    fails(validateList({ ...ok, sections: [{ rows: [{ id: "x", title: "1" }, { id: "x", title: "2" }] }] }), /row ids must be unique/);
  });
});

describe("cta_url", () => {
  const ok = { body: "Go", buttonText: "Open", url: "https://example.com" };
  it("passes", () => assert.deepEqual(validateCtaUrl(ok), []));
  it("button 20, header 60, valid url", () => {
    fails(validateCtaUrl({ ...ok, buttonText: s(21) }), /CTA button text exceeds 20/);
    fails(validateCtaUrl({ ...ok, headerText: s(61) }), /header exceeds 60/);
    fails(validateCtaUrl({ ...ok, url: "not a url" }), /not a valid URL/);
    fails(validateCtaUrl({ ...ok, url: "ftp://example.com" }), /must be http\(s\)/);
  });
});

describe("flow", () => {
  const ok: FlowInput = { flowId: "123", flowToken: "demo:abc", flowCta: "Buy", body: "Choose" };

  it("defaults: version 3, published, navigate, no payload", () => {
    assert.deepEqual(validateFlow(ok), []);
    const i = interactiveOf(buildFlow(TO, ok));
    assert.equal(i.type, "flow");
    assert.equal(i.action.name, "flow");
    assert.deepEqual(i.action.parameters, {
      flow_message_version: "3",
      flow_id: "123",
      flow_token: "demo:abc",
      flow_cta: "Buy",
      mode: "published",
      flow_action: "navigate",
      flow_action_payload: undefined,
    });
  });
  it("navigate can start on a given screen, data serialized as a string", () => {
    const i = interactiveOf(buildFlow(TO, { ...ok, mode: "draft", screen: "CUSTOM_AMOUNT", data: { brand: "A" } }));
    assert.equal(i.action.parameters.mode, "draft");
    assert.deepEqual(i.action.parameters.flow_action_payload, { screen: "CUSTOM_AMOUNT", data: '{"brand":"A"}' });
  });
  it("data_exchange takes no payload", () => {
    assert.deepEqual(validateFlow({ ...ok, flowAction: "data_exchange" }), []);
    assert.equal(interactiveOf(buildFlow(TO, { ...ok, flowAction: "data_exchange" })).action.parameters.flow_action_payload, undefined);
    fails(validateFlow({ ...ok, flowAction: "data_exchange", screen: "ITEM" }), /only allowed with flow_action navigate/);
  });
  it("rejects empty data, long CTA, missing token/id", () => {
    fails(validateFlow({ ...ok, data: {} }), /non-empty object/);
    fails(validateFlow({ ...ok, flowCta: s(31) }), /flow_cta exceeds 30/);
    fails(validateFlow({ ...ok, flowToken: "" }), /flow_token must not be empty/);
    fails(validateFlow({ ...ok, flowId: "" }), /flow_id must not be empty/);
  });
});

describe("carousel", () => {
  const card = (i: number, kind: "cta_url" | "quick_reply" = "cta_url") => ({
    imageUrl: `https://example.com/${i}.png`,
    body: `Card ${i}`,
    buttons: [
      kind === "cta_url"
        ? ({ kind, displayText: "Buy", url: `https://example.com/${i}` } as const)
        : ({ kind, id: `q${i}`, title: "Pick" } as const),
    ],
  });
  const ok: CarouselInput = { body: "Pick a brand", cards: [card(0), card(1)] };

  it("passes; card_index from order; image header; card-level type per docs", () => {
    assert.deepEqual(validateCarousel(ok), []);
    const cards = interactiveOf(buildCarousel(TO, ok)).action.cards;
    assert.deepEqual(cards.map((c: any) => c.card_index), [0, 1]);
    assert.deepEqual(cards[0].header, { type: "image", image: { link: "https://example.com/0.png" } });
    assert.deepEqual(cards[0].action, { name: "cta_url", parameters: { display_text: "Buy", url: "https://example.com/0" } });
    assert.equal(cards[0].type, "cta_url");
  });
  it("quick_reply cards build a buttons array", () => {
    const qr = { body: "Pick", cards: [card(0, "quick_reply"), card(1, "quick_reply")] };
    assert.deepEqual(validateCarousel(qr), []);
    assert.deepEqual(interactiveOf(buildCarousel(TO, qr)).action.cards[1].action, {
      buttons: [{ type: "quick_reply", quick_reply: { id: "q1", title: "Pick" } }],
    });
  });
  it("quick_reply cards may carry several buttons, same count on every card; cta_url cards exactly one", () => {
    const two = (i: number) => ({ ...card(i, "quick_reply"), buttons: [{ kind: "quick_reply" as const, id: `a${i}`, title: "Select" }, { kind: "quick_reply" as const, id: `b${i}`, title: "View product" }] });
    assert.deepEqual(validateCarousel({ body: "b", cards: [two(0), two(1)] }), []);
    assert.deepEqual(interactiveOf(buildCarousel(TO, { body: "b", cards: [two(0), two(1)] })).action.cards[0].action.buttons.map((b: any) => b.quick_reply.id), ["a0", "b0"]);
    fails(validateCarousel({ body: "b", cards: [two(0), card(1, "quick_reply")] }), /same button types and count/);
    const twoCta = validateCarousel({ body: "b", cards: [0, 1].map((i) => ({ ...card(i), buttons: [...card(i).buttons, ...card(i).buttons] })) });
    assert.deepEqual(twoCta, ["card 0: a cta_url card has exactly one button", "card 1: a cta_url card has exactly one button"]);
    fails(validateCarousel({ body: "b", cards: [{ ...two(0), buttons: [two(0).buttons[0]!, { ...two(0).buttons[1]!, title: "Select" }] }, { ...two(1), buttons: [two(1).buttons[0]!, { ...two(1).buttons[1]!, title: "Select" }] }] }).slice(0, 1), /card 0 quick reply titles must be unique/);
  });
  it("2-10 cards", () => {
    fails(validateCarousel({ ...ok, cards: [card(0)] }), /cards: need 2-10, got 1/);
    fails(validateCarousel({ ...ok, cards: Array.from({ length: 11 }, (_, i) => card(i)) }), /got 11/);
  });
  it("card body max 160 and max 2 line breaks", () => {
    assert.deepEqual(validateCarousel({ ...ok, cards: [{ ...card(0), body: "a\nb\nc" }, card(1)] }), []);
    fails(validateCarousel({ ...ok, cards: [{ ...card(0), body: "a\nb\nc\nd" }, card(1)] }), /more than 2 line breaks/);
    fails(validateCarousel({ ...ok, cards: [{ ...card(0), body: s(161) }, card(1)] }), /card 0 body exceeds 160/);
  });
  it("all cards must share the button kind; quick reply ids unique; https images", () => {
    fails(validateCarousel({ ...ok, cards: [card(0), card(1, "quick_reply")] }), /same button types and count/);
    fails(validateCarousel({ ...ok, cards: [card(0, "quick_reply"), { ...card(1, "quick_reply"), buttons: [{ kind: "quick_reply", id: "q0", title: "x" }] }] }), /quick reply ids must be unique/);
    fails(validateCarousel({ ...ok, cards: [{ ...card(0), imageUrl: "http://example.com/a.png" }, card(1)] }), /image must be https/);
    fails(validateCarousel({ ...ok, cards: [{ ...card(0), buttons: [{ kind: "cta_url", displayText: s(21), url: "https://e.com" }] }, card(1)] }), /button text exceeds 20/);
  });
});

describe("product_list / product", () => {
  const ok: ProductListInput = { catalogId: "cat", header: "Gifts", body: "Pick", sections: [{ title: "Food", productRetailerIds: ["a", "b"] }] };

  it("passes and builds product_items", () => {
    assert.deepEqual(validateProductList(ok), []);
    const i = interactiveOf(buildProductList(TO, ok));
    assert.deepEqual(i.header, { type: "text", text: "Gifts" });
    assert.deepEqual(i.action.sections[0].product_items, [{ product_retailer_id: "a" }, { product_retailer_id: "b" }]);
  });
  it("max 30 products, max 10 sections", () => {
    const ids = (n: number, p = "p") => Array.from({ length: n }, (_, i) => `${p}${i}`);
    assert.deepEqual(validateProductList({ ...ok, sections: [{ title: "A", productRetailerIds: ids(30) }] }), []);
    fails(validateProductList({ ...ok, sections: [{ title: "A", productRetailerIds: ids(31) }] }), /products across all sections: need 1-30, got 31/);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ title: `S${i}`, productRetailerIds: [`p${i}`] }));
    fails(validateProductList({ ...ok, sections: eleven }), /sections: need 1-10, got 11/);
  });
  it("header required; section title required; no empty sections; unique ids", () => {
    fails(validateProductList({ ...ok, header: "" }), /header must not be empty/);
    fails(validateProductList({ ...ok, sections: [{ title: "", productRetailerIds: ["a"] }] }), /section title must not be empty/);
    assert.ok(validateProductList({ ...ok, sections: [{ title: "A", productRetailerIds: [] }] }).some((i) => /has no products/.test(i)));
    fails(validateProductList({ ...ok, sections: [{ title: "A", productRetailerIds: ["a"] }, { title: "B", productRetailerIds: ["a"] }] }), /must be unique/);
  });
  it("single product: catalog + retailer id, no header", () => {
    const p = { catalogId: "cat", productRetailerId: "sku1", body: "Look" };
    assert.deepEqual(validateProduct(p), []);
    const i = interactiveOf(buildProduct(TO, p));
    assert.deepEqual(i.action, { catalog_id: "cat", product_retailer_id: "sku1" });
    assert.equal(i.header, undefined);
    fails(validateProduct({ ...p, productRetailerId: "" }), /product_retailer_id must not be empty/);
  });
});

describe("order_details / order_status", () => {
  const ok: OrderDetailsInput = {
    referenceId: "ORD-ABC123",
    goodsType: "digital-goods",
    gateway: "razorpay",
    configurationName: "demo-config",
    body: "Your order",
    catalogId: "cat",
    items: [{ name: "Sample gift item", amountPaise: 50000, quantity: 2 }],
    taxPaise: 0,
    discountPaise: 5000,
  };

  it("passes; total = subtotal + tax + shipping - discount, in paise with offset 100", () => {
    assert.deepEqual(validateOrderDetails(ok), []);
    assert.equal(orderTotalPaise(ok), 95000);
    const i = interactiveOf(buildOrderDetails(TO, ok));
    assert.equal(i.type, "order_details");
    assert.equal(i.action.name, "review_and_pay");
    const p = i.action.parameters;
    assert.deepEqual(p.total_amount, { value: 95000, offset: 100 });
    assert.deepEqual(p.order.subtotal, { value: 100000, offset: 100 });
    assert.equal(p.order.status, "pending");
    assert.equal(p.currency, "INR");
    assert.deepEqual(p.payment_settings, [{ type: "payment_gateway", payment_gateway: { type: "razorpay", configuration_name: "demo-config" } }]);
  });
  it("sale amount drives the subtotal", () => {
    assert.equal(orderTotalPaise({ ...ok, items: [{ name: "x", amountPaise: 1000, salePaise: 800, quantity: 2 }], discountPaise: 0 }), 1600);
  });
  it("rejects bad reference ids, fractional paise, bad quantity, sale >= amount", () => {
    fails(validateOrderDetails({ ...ok, referenceId: "has space" }), /reference_id/);
    fails(validateOrderDetails({ ...ok, referenceId: s(36) }), /reference_id/);
    fails(validateOrderDetails({ ...ok, discountPaise: 0, items: [{ name: "x", amountPaise: 10.5, quantity: 1 }] }), /amount must be an integer/);
    fails(validateOrderDetails({ ...ok, items: [{ name: "x", amountPaise: 100000, quantity: 0 }, { name: "y", amountPaise: 100000, quantity: 1 }] }), /quantity must be a positive integer/);
    fails(validateOrderDetails({ ...ok, items: [{ name: "x", amountPaise: 1000, salePaise: 1000, quantity: 1 }], discountPaise: 0 }), /sale amount must be less/);
    fails(validateOrderDetails({ ...ok, items: [] }), /at least 1/);
  });
  it("items need importer details without a catalog; total must be positive; expiration >= 300s", () => {
    fails(validateOrderDetails({ ...ok, catalogId: undefined }), /needs countryOfOrigin/);
    fails(validateOrderDetails({ ...ok, discountPaise: 100000 }), /total amount must be positive/);
    fails(validateOrderDetails({ ...ok, expiresAt: 1000 + 299 }, 1000), /at least 300 seconds/);
    assert.deepEqual(validateOrderDetails({ ...ok, expiresAt: 1000 + 300 }, 1000), []);
  });
  it("order_status: review_order with an allowed status", () => {
    const st = { referenceId: "ORD-ABC123", status: "completed" as const, body: "Done" };
    assert.deepEqual(validateOrderStatus(st), []);
    const i = interactiveOf(buildOrderStatus(TO, st));
    assert.equal(i.action.name, "review_order");
    assert.deepEqual(i.action.parameters, { reference_id: "ORD-ABC123", order: { status: "completed", description: undefined } });
    fails(validateOrderStatus({ ...st, status: "delivered" as never }), /status must be one of/);
    fails(validateOrderStatus({ ...st, description: s(121) }), /description exceeds 120/);
  });
});

describe("WhatsAppClient guard + payment gate", () => {
  async function setup() {
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
    const { WhatsAppClient, maskPhone } = await import("./client.js");
    const { createDemoSendGuard, DemoSendBlockedError } = await import("../commerce-demo/sendGuard.js");

    class Fake extends WhatsAppClient {
      posted: any[] = [];
      protected override async post(body: unknown) {
        this.posted.push(body);
        return { messages: [{ id: "wamid.test" }] };
      }
    }
    return { Fake, maskPhone, createDemoSendGuard, DemoSendBlockedError };
  }

  it("blocks every send when DEMO_SEND_ENABLED is off, even for allowlisted numbers", async () => {
    const { Fake, createDemoSendGuard, DemoSendBlockedError } = await setup();
    const client = new Fake({ sendGuard: createDemoSendGuard({ enabled: false, allowedRecipients: [TO] }) });
    await assert.rejects(client.sendText(TO, "hi"), (e: unknown) => e instanceof DemoSendBlockedError && e.reason === "disabled");
    await assert.rejects(client.sendFlow(TO, { flowId: "1", flowToken: "t", flowCta: "Go", body: "b" }), DemoSendBlockedError);
    assert.equal(client.posted.length, 0);
  });

  it("blocks recipients outside DEMO_ALLOWED_RECIPIENTS, without leaking the number", async () => {
    const { Fake, createDemoSendGuard } = await setup();
    const client = new Fake({ sendGuard: createDemoSendGuard({ enabled: true, allowedRecipients: [TO] }) });
    await assert.rejects(client.sendReplyButtons("911111112222", "b", [{ id: "a", title: "A" }]), (e: any) => {
      assert.equal(e.reason, "not_allowlisted");
      assert.ok(!e.message.includes("911111112222"));
      assert.match(e.message, /\*+2222/);
      return true;
    });
    assert.equal(client.posted.length, 0);
  });

  it("lets allowlisted recipients through when enabled", async () => {
    const { Fake, createDemoSendGuard } = await setup();
    const client = new Fake({ sendGuard: createDemoSendGuard({ enabled: true, allowedRecipients: [TO] }) });
    assert.equal(await client.sendCarousel(TO, { body: "b", cards: [0, 1].map((i) => ({ imageUrl: "https://e.com/a.png", buttons: [{ kind: "quick_reply" as const, id: `q${i}`, title: "t" }] })) }), "wamid.test");
    assert.equal(client.posted.length, 1);
  });

  it("validation runs before the guard and the network", async () => {
    const { Fake } = await setup();
    const client = new Fake();
    await assert.rejects(client.sendList(TO, "b", s(21), [{ rows: [{ id: "r", title: "t" }] }]), PayloadValidationError);
    assert.equal(client.posted.length, 0);
  });

  it("payments use the demo provider (no Meta call) without WA_PAYMENT_CONFIG_NAME", async () => {
    const { Fake } = await setup();
    const order = { referenceId: "ORD-1", goodsType: "digital-goods" as const, gateway: "razorpay" as const, body: "b", catalogId: "c", items: [{ name: "x", amountPaise: 100, quantity: 1 }], taxPaise: 0 };
    const demo = new Fake({ paymentConfigName: undefined });
    assert.deepEqual(await demo.sendOrderDetails(TO, order), { provider: "demo" });
    assert.deepEqual(await demo.sendOrderStatus(TO, { referenceId: "ORD-1", status: "completed", body: "b" }), { provider: "demo" });
    assert.equal(demo.posted.length, 0);
    // Still validated on the demo path.
    await assert.rejects(demo.sendOrderDetails(TO, { ...order, items: [] }), PayloadValidationError);

    const live = new Fake({ paymentConfigName: "my-config" });
    assert.deepEqual(await live.sendOrderDetails(TO, order), { provider: "whatsapp", wamid: "wamid.test" });
    assert.equal(live.posted[0].interactive.action.parameters.payment_settings[0].payment_gateway.configuration_name, "my-config");
  });

  it("masks phone numbers", async () => {
    const { maskPhone } = await setup();
    assert.equal(maskPhone("919812345678"), "********5678");
    assert.equal(maskPhone("123"), "****");
  });
});
