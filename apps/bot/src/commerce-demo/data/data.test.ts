/**
 * Unit tests for the commerce demo's data + rules. Pure — no Postgres, no
 * network. Run: pnpm --filter bot test:commerce
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBrand, getDataset, PRESET_AMOUNTS, type Brand } from "./catalog";
import { offersForBrand, priceOrder, PROMOS, validateAmount, validatePromo, type Promo } from "./rules";
import { DEFAULT_POINTS_BALANCE, PointsLedger } from "./points";
import { DEMO_FAILURE_TRIGGERS, newDemoOrder, OrderStore, type NewOrder } from "./orders";
import {
  CATALOG_CSV_COLUMNS,
  CATALOG_LIMITS,
  catalogRows,
  catalogSections,
  featuredAmount,
  parseRetailerId,
  retailerIdFor,
  toCsv,
} from "./products";

const neutral = getDataset("neutral");
const brand = (id: string): Brand => findBrand(neutral, id)!;
const A = brand("brand_a"); // Food, 100–10000 step 50
const B = brand("brand_b"); // Shopping
const C = brand("brand_c"); // Travel, 250–10000 step 250
const D = brand("brand_d"); // Entertainment, 100–5000 step 50
const promo = (code: string): Promo => PROMOS.find((p) => p.code === code)!;

describe("catalog", () => {
  it("has brands A–D in Food, Shopping, Travel, Entertainment", () => {
    assert.deepEqual(
      neutral.brands.map((b) => [b.name, b.category]),
      [
        ["Sample brand A", "Food"],
        ["Sample brand B", "Shopping"],
        ["Sample brand C", "Travel"],
        ["Sample brand D", "Entertainment"],
      ],
    );
    assert.ok(neutral.brands.every((b) => b.itemName === "Sample gift item"));
  });

  it("voucher dataset has the same shape with voucher wording", () => {
    const voucher = getDataset("voucher");
    const shape = (b: Brand) => [b.id, b.name, b.category, b.presetAmounts, b.limits];
    assert.deepEqual(voucher.brands.map(shape), neutral.brands.map(shape));
    assert.ok(voucher.brands.every((b) => /gift voucher$/.test(b.itemName)));
    assert.notEqual(voucher.codePrefix, neutral.codePrefix);
    assert.ok([voucher, neutral].every((d) => d.codePrefix.startsWith("DEMO-")));
  });

  it("images are public https PNGs at 4:3", () => {
    for (const b of neutral.brands) {
      const url = new URL(b.imageUrl);
      assert.equal(url.protocol, "https:");
      assert.match(url.pathname, /\.png$/);
      const [, w, h] = url.pathname.match(/\/(\d+)x(\d+)\//)!;
      assert.equal(Number(w) * 3, Number(h) * 4, `${b.id} is not 4:3`);
    }
  });

  it("every brand offers the presets, and every preset is a valid amount for it", () => {
    for (const b of neutral.brands) {
      assert.deepEqual(b.presetAmounts, [250, 500, 1000, 2000, 5000]);
      for (const amount of PRESET_AMOUNTS) assert.ok(validateAmount(b, amount).ok, `${b.id} ${amount}`);
    }
  });

  it("findBrand returns undefined for unknown ids", () => {
    assert.equal(findBrand(neutral, "nope"), undefined);
  });
});

describe("validateAmount", () => {
  it("accepts min, max and step multiples", () => {
    for (const amount of [100, 150, 9950, 10000]) assert.deepEqual(validateAmount(A, amount), { ok: true });
  });

  const message = "Enter an amount between ₹100 and ₹10,000 in steps of ₹50";
  for (const [amount, reason] of [
    [50, "below_min"],
    [0, "below_min"],
    [-100, "below_min"],
    [10050, "above_max"],
    [125, "not_step"],
    [100.5, "not_integer"],
    [NaN, "not_integer"],
  ] as const) {
    it(`rejects ${amount} as ${reason}`, () => {
      assert.deepEqual(validateAmount(A, amount), { ok: false, reason, message });
    });
  }

  it("message uses the brand's own limits", () => {
    const result = validateAmount(C, 300);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message, "Enter an amount between ₹250 and ₹10,000 in steps of ₹250");
    assert.equal(validateAmount(D, 5050).ok, false); // D caps at 5000
  });
});

describe("validatePromo", () => {
  it("accepts valid codes case-insensitively and trimmed", () => {
    const result = validatePromo("  welcome10 ", A, 500);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.promo.code, "WELCOME10");
  });

  it("rejects unknown codes", () => {
    assert.deepEqual(validatePromo("FREE100", A, 1000), {
      ok: false,
      reason: "invalid",
      message: "FREE100 is not a valid promo code",
    });
    assert.equal(validatePromo("", A, 1000).ok, false);
  });

  it("WELCOME10 is brand A only", () => {
    const result = validatePromo("WELCOME10", B, 1000);
    assert.deepEqual(result, { ok: false, reason: "wrong_brand", message: "WELCOME10 can't be used for Sample brand B" });
  });

  it("TRAVEL15 is travel only, minimum ₹1,000", () => {
    const wrongBrand = validatePromo("TRAVEL15", A, 5000);
    assert.equal(wrongBrand.ok === false && wrongBrand.reason, "wrong_brand");
    assert.deepEqual(validatePromo("TRAVEL15", C, 750), {
      ok: false,
      reason: "min_not_met",
      shortfall: 250,
      message: "Add ₹250 more to use TRAVEL15 (minimum order ₹1,000)",
    });
    assert.equal(validatePromo("TRAVEL15", C, 1000).ok, true);
  });

  it("GIFT50 works on any brand at ₹500, not ₹499", () => {
    for (const b of [A, B, C, D]) assert.equal(validatePromo("GIFT50", b, 500).ok, true);
    const result = validatePromo("GIFT50", B, 499);
    assert.equal(result.ok === false && result.reason === "min_not_met" && result.shortfall, 1);
  });

  it("TREAT5 works on any brand with no minimum", () => {
    for (const b of [A, B, C, D]) assert.equal(validatePromo("TREAT5", b, 100).ok, true);
  });

  it("brand check comes before minimum check", () => {
    const result = validatePromo("TRAVEL15", A, 100);
    assert.equal(result.ok === false && result.reason, "wrong_brand");
  });
});

describe("offersForBrand", () => {
  const summary = (b: Brand, subtotal?: number) =>
    offersForBrand(b, subtotal).map((o) => [o.promo.code, o.eligible, o.shortfall]);

  it("brand A: WELCOME10, GIFT50, TREAT5 — GIFT50 ineligible below ₹500", () => {
    assert.deepEqual(summary(A, 250), [
      ["WELCOME10", true, 0],
      ["GIFT50", false, 250],
      ["TREAT5", true, 0],
    ]);
  });

  it("defaults to subtotal 0", () => {
    assert.deepEqual(summary(B), [
      ["GIFT50", false, 500],
      ["TREAT5", true, 0],
    ]);
  });

  it("travel brand gets TRAVEL15 with a shortfall below ₹1,000", () => {
    assert.deepEqual(summary(C, 600), [
      ["GIFT50", true, 0],
      ["TREAT5", true, 0],
      ["TRAVEL15", false, 400],
    ]);
    assert.ok(offersForBrand(C, 1000).every((o) => o.eligible));
  });

  it("non-travel, non-A brands never see WELCOME10 or TRAVEL15", () => {
    for (const b of [B, D]) {
      const codes = offersForBrand(b, 10000).map((o) => o.promo.code);
      assert.deepEqual(codes, ["GIFT50", "TREAT5"]);
    }
  });
});

describe("priceOrder", () => {
  it("no promo, online", () => {
    assert.deepEqual(priceOrder(500, 2, null, "online", 2500), {
      subtotal: 1000,
      discount: 0,
      total: 1000,
      pointsUsed: 0,
      onlineDue: 1000,
    });
  });

  it("percent promo below cap", () => {
    assert.equal(priceOrder(500, 1, promo("WELCOME10"), "online", 0).discount, 50);
  });

  it("percent promos are capped", () => {
    assert.equal(priceOrder(2000, 1, promo("WELCOME10"), "online", 0).discount, 100); // 10% = 200
    assert.equal(priceOrder(2000, 1, promo("TREAT5"), "online", 0).discount, 75); // 5% = 100
    assert.equal(priceOrder(5000, 1, promo("TRAVEL15"), "online", 0).discount, 300); // 15% = 750
    assert.equal(priceOrder(1000, 1, promo("TRAVEL15"), "online", 0).discount, 150);
  });

  it("percent discount rounds down to whole rupees", () => {
    assert.equal(priceOrder(350, 1, promo("TREAT5"), "online", 0).discount, 17); // 17.5
  });

  it("flat promo has no cap", () => {
    assert.equal(priceOrder(5000, 2, promo("GIFT50"), "online", 0).discount, 50);
  });

  it("promo gives nothing below its minimum order", () => {
    assert.equal(priceOrder(250, 1, promo("GIFT50"), "online", 0).discount, 0);
    assert.equal(priceOrder(250, 2, promo("GIFT50"), "online", 0).discount, 50); // qty counts toward minimum
    assert.equal(priceOrder(500, 1, promo("TRAVEL15"), "online", 0).discount, 0);
  });

  it("split uses all points when the balance is below the total", () => {
    assert.deepEqual(priceOrder(5000, 1, null, "split", 2500), {
      subtotal: 5000,
      discount: 0,
      total: 5000,
      pointsUsed: 2500,
      onlineDue: 2500,
    });
  });

  it("split uses only what's needed when the balance covers the total", () => {
    const p = priceOrder(1000, 1, null, "split", 2500);
    assert.equal(p.pointsUsed, 1000);
    assert.equal(p.onlineDue, 0);
  });

  it("split applies points after the discount", () => {
    const p = priceOrder(2000, 2, promo("GIFT50"), "split", 2500);
    assert.deepEqual(p, { subtotal: 4000, discount: 50, total: 3950, pointsUsed: 2500, onlineDue: 1450 });
  });

  it("split with zero points is all online", () => {
    assert.equal(priceOrder(500, 1, null, "split", 0).onlineDue, 500);
  });

  it("online ignores the points balance", () => {
    assert.equal(priceOrder(500, 1, null, "online", 2500).pointsUsed, 0);
  });

  it("rejects bad inputs", () => {
    assert.throws(() => priceOrder(500, 0, null, "online", 0), RangeError);
    assert.throws(() => priceOrder(500, 1.5, null, "online", 0), RangeError);
    assert.throws(() => priceOrder(0, 1, null, "online", 0), RangeError);
    assert.throws(() => priceOrder(99.5, 1, null, "online", 0), RangeError);
    assert.throws(() => priceOrder(500, 1, null, "split", -1), RangeError);
  });
});

describe("PointsLedger", () => {
  it("every recipient starts at the default balance, independently", () => {
    const ledger = new PointsLedger();
    assert.equal(DEFAULT_POINTS_BALANCE, 2500);
    ledger.capture(ledger.hold("u1", 1000));
    assert.equal(ledger.balance("u1"), 1500);
    assert.equal(ledger.balance("u2"), 2500);
  });

  it("hold reserves without spending; capture spends", () => {
    const ledger = new PointsLedger();
    const id = ledger.hold("u", 1000);
    assert.equal(ledger.balance("u"), 2500);
    assert.equal(ledger.available("u"), 1500);
    assert.equal(ledger.capture(id), true);
    assert.equal(ledger.balance("u"), 1500);
    assert.equal(ledger.available("u"), 1500);
  });

  it("release returns the reservation", () => {
    const ledger = new PointsLedger();
    const id = ledger.hold("u", 1000);
    assert.equal(ledger.release(id), true);
    assert.equal(ledger.available("u"), 2500);
    assert.equal(ledger.balance("u"), 2500);
  });

  it("cannot hold more than available, including other holds", () => {
    const ledger = new PointsLedger();
    assert.throws(() => ledger.hold("u", 2501), /insufficient points/);
    ledger.hold("u", 2000);
    assert.throws(() => ledger.hold("u", 501), /insufficient points/);
    ledger.hold("u", 500); // exactly the rest
    assert.equal(ledger.available("u"), 0);
  });

  it("rejects non-positive or fractional holds", () => {
    const ledger = new PointsLedger();
    for (const n of [0, -5, 1.5]) assert.throws(() => ledger.hold("u", n), RangeError);
  });

  it("capture and release are idempotent (duplicate events)", () => {
    const ledger = new PointsLedger();
    const id = ledger.hold("u", 500);
    assert.equal(ledger.capture(id), true);
    assert.equal(ledger.capture(id), false);
    assert.equal(ledger.release(id), false);
    assert.equal(ledger.balance("u"), 2000);
    assert.equal(ledger.capture("unknown"), false);
    assert.equal(ledger.release("unknown"), false);
  });
});

describe("OrderStore", () => {
  const newOrder = (qty = 1, userId = "u"): NewOrder => ({
    userId,
    brandId: "brand_a",
    amount: 500,
    qty,
    promoCode: null,
    price: priceOrder(500, qty, null, "online", 0),
    pointsHoldId: null,
  });

  it("creates pending_payment orders and lists them per user", () => {
    const store = new OrderStore("DEMO-ITEM");
    const o = store.create(newOrder());
    store.create(newOrder(1, "other"));
    assert.equal(o.status, "pending_payment");
    assert.match(o.id, /^ORD-[A-Z2-9]{8}$/);
    assert.equal(store.get(o.id), o);
    assert.deepEqual(store.listForUser("u").map((x) => x.id), [o.id]);
    assert.equal(store.get("ORD-NOPE"), undefined);
  });

  it("happy path: paid -> processing -> delivered with one random code per unit", () => {
    const store = new OrderStore("DEMO-ITEM");
    const o = store.create(newOrder(3));
    assert.equal(store.markPaid(o.id).order.status, "processing");
    store.fulfil(o.id);
    assert.equal(o.status, "delivered");
    assert.equal(o.codes.length, 3);
    for (const code of o.codes) assert.match(code, /^DEMO-ITEM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(new Set(o.codes).size, 3);
    const other = store.create(newOrder(1));
    store.markPaid(other.id);
    store.fulfil(other.id);
    assert.notEqual(other.codes[0], o.codes[0]);
  });

  it(`qty ${DEMO_FAILURE_TRIGGERS.issuanceFailsQty}: issuance fails after payment`, () => {
    const store = new OrderStore("DEMO-ITEM");
    const o = store.create(newOrder(DEMO_FAILURE_TRIGGERS.issuanceFailsQty));
    store.markPaid(o.id);
    store.fulfil(o.id);
    assert.equal(o.status, "failed");
    assert.equal(o.failureReason, "issuance_failed");
    assert.deepEqual(o.codes, []);
  });

  it(`qty ${DEMO_FAILURE_TRIGGERS.duplicateEventQty}: duplicate payment events are absorbed`, () => {
    const store = new OrderStore("DEMO-ITEM");
    const o = store.create(newOrder(DEMO_FAILURE_TRIGGERS.duplicateEventQty));
    assert.equal(store.markPaid(o.id).duplicate, false);
    assert.equal(store.markPaid(o.id).duplicate, true);
    store.fulfil(o.id);
    const codes = [...o.codes];
    assert.equal(codes.length, 9);
    assert.equal(store.markPaid(o.id).duplicate, true); // after delivery too
    store.fulfil(o.id);
    assert.deepEqual(o.codes, codes); // no second issuance
    assert.equal(o.status, "delivered");
  });

  it("cancel only from pending_payment", () => {
    const store = new OrderStore("DEMO-ITEM");
    const o = store.create(newOrder());
    assert.equal(store.cancel(o.id).status, "cancelled");
    assert.throws(() => store.markPaid(o.id), /cannot mark paid/);
    const paid = store.create(newOrder());
    store.markPaid(paid.id);
    assert.throws(() => store.cancel(paid.id), /cannot cancel/);
  });

  it("cannot fulfil before payment", () => {
    const store = new OrderStore("DEMO-ITEM");
    const o = store.create(newOrder());
    assert.throws(() => store.fulfil(o.id), /cannot fulfil/);
  });

  it("fail from pending_payment or processing, not from terminal states", () => {
    const store = new OrderStore("DEMO-ITEM");
    const a = store.create(newOrder());
    assert.equal(store.fail(a.id, "payment_declined").failureReason, "payment_declined");
    const b = store.create(newOrder());
    store.markPaid(b.id);
    assert.equal(store.fail(b.id, "timeout").status, "failed");
    assert.throws(() => store.fail(a.id, "again"), /cannot fail/);
    assert.throws(() => store.markPaid(a.id), /cannot mark paid/);
  });

  it("unknown order ids throw", () => {
    const store = new OrderStore("DEMO-ITEM");
    assert.throws(() => store.markPaid("ORD-NOPE"), /unknown order/);
  });
});

describe("config startup guard", () => {
  const baseEnv = {
    WHATSAPP_TOKEN: "t",
    PHONE_NUMBER_ID: "111",
    VERIFY_TOKEN: "v",
    WEB_FORM_URL: "https://example.com/form",
    BANNER_IMAGE_URL: "https://example.com/banner.png",
    DATABASE_URL: "postgresql://x",
    INTERNAL_API_SECRET: "s",
    AI_SERVICE_URL: "https://example.com/ai",
    AI_SERVICE_TOKEN: "a",
  };

  it("voucher on a protected PHONE_NUMBER_ID fails; otherwise passes; default is neutral", async () => {
    // config.ts validates process.env eagerly on import — give it a valid one first.
    for (const [k, v] of Object.entries(baseEnv)) process.env[k] ??= v;
    const { envSchema } = await import("../../config.js");

    const parse = (extra: Record<string, string>) => envSchema.safeParse({ ...baseEnv, ...extra });
    const blocked = parse({ DEMO_DATASET: "voucher", PROTECTED_PHONE_NUMBER_IDS: "999, 111" });
    assert.equal(blocked.success, false);
    assert.match(blocked.error!.issues[0]!.message, /voucher is not allowed/);

    assert.equal(parse({ DEMO_DATASET: "voucher", PROTECTED_PHONE_NUMBER_IDS: "999" }).success, true);
    assert.equal(parse({ DEMO_DATASET: "neutral", PROTECTED_PHONE_NUMBER_IDS: "111" }).success, true);
    assert.equal(parse({ DEMO_DATASET: "other" }).success, false);
    assert.equal(parse({}).data?.DEMO_DATASET, "neutral");
  });
});

describe("catalog products", () => {

  it("retailer ids round-trip to brand + amount", () => {
    assert.equal(retailerIdFor(A, 500), "demo-a-500");
    for (const b of neutral.brands) {
      for (const amount of b.presetAmounts) {
        const back = parseRetailerId(neutral, retailerIdFor(b, amount));
        assert.equal(back?.brand.id, b.id);
        assert.equal(back?.amount, amount);
      }
    }
  });

  it("unknown retailer ids map to nothing", () => {
    for (const id of ["demo-z-500", "demo-a-501", "demo-a-100", "a-500", "demo-a-", "", "DEMO-A-500", "demo-a-500-x"]) {
      assert.equal(parseRetailerId(neutral, id), undefined, id);
    }
  });

  it("CSV: header, one row per brand × preset, required feed fields", () => {
    const csv = toCsv(catalogRows(neutral, "https://shop.example.in/p"));
    const lines = csv.trimEnd().split("\n");
    assert.equal(lines[0], "id,title,description,availability,condition,price,link,image_link,brand,custom_label_0,product_type");
    assert.equal(lines.length, 1 + 4 * 5);
    const rows = catalogRows(neutral, "https://shop.example.in/p");
    const a500 = rows.find((r) => r.id === "demo-a-500")!;
    assert.deepEqual(a500, {
      id: "demo-a-500",
      title: "Sample brand A ₹500",
      description: "Sample gift item worth ₹500. Demo product with fake data, not for sale.",
      availability: "in stock",
      condition: "new",
      price: "500.00 INR",
      link: "https://shop.example.in/p/demo-a-500",
      image_link: A.imageUrl,
      brand: "Sample brand A",
      custom_label_0: "brand_a",
      product_type: "Demo > Food",
    });
    // "₹5,000" contains a comma: those fields must be quoted.
    assert.ok(csv.includes('demo-a-5000,"Sample brand A ₹5,000","Sample gift item worth ₹5,000. Demo product with fake data, not for sale.",in stock,new,5000.00 INR,'));
    assert.ok(lines.slice(1).every((l) => l.startsWith("demo-")));
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, "ids unique");
    assert.equal(CATALOG_CSV_COLUMNS.length, 11);
  });

  it("CSV quotes commas, quotes and newlines", () => {
    const row = { ...catalogRows(neutral, "https://x.in/")[0]!, description: 'say "hi", then\nleave' };
    assert.match(toCsv([row]), /,"say ""hi"", then\nleave",/);
  });

  it("voucher dataset feed uses voucher wording, same ids", () => {
    const rows = catalogRows(getDataset("voucher"), "https://x.in/");
    assert.equal(rows[0]!.id, "demo-a-250");
    assert.match(rows[0]!.description, /Sample brand A gift voucher/);
  });

  it("product list: one section per brand titled with the brand name, presets as items", () => {
    const sections = catalogSections(neutral);
    assert.deepEqual(sections.map((s) => s.title), ["Sample brand A", "Sample brand B", "Sample brand C", "Sample brand D"]);
    assert.deepEqual(sections[0]!.productRetailerIds, ["demo-a-250", "demo-a-500", "demo-a-1000", "demo-a-2000", "demo-a-5000"]);
  });

  it("product list respects max 10 sections and 30 products", () => {
    const many = { ...neutral, brands: Array.from({ length: 12 }, (_, i) => ({ ...A, id: `brand_${i}`, name: `Brand ${i}` })) };
    const sections = catalogSections(many);
    assert.ok(sections.length <= CATALOG_LIMITS.maxSections);
    assert.equal(sections.flatMap((s) => s.productRetailerIds).length, CATALOG_LIMITS.maxProducts);
    assert.ok(sections.every((s) => s.productRetailerIds.length > 0));
  });

  it("featured amount is ₹500 when offered", () => {
    assert.equal(featuredAmount(A), 500);
    assert.equal(featuredAmount({ ...A, presetAmounts: [250, 1000] }), 250);
  });

  it("orders have the same shape whatever their source (preset, custom, cart)", () => {
    const preset = newDemoOrder({ userId: "u", brandId: "brand_a", amount: 500, qty: 2, promo: null });
    const custom = newDemoOrder({ userId: "u", brandId: "brand_c", amount: 750, qty: 1, promo: promo("TREAT5") });
    assert.deepEqual(Object.keys(custom).sort(), Object.keys(preset).sort());
    assert.deepEqual(custom.price, { subtotal: 750, discount: 37, total: 713, pointsUsed: 0, onlineDue: 713 });
    assert.equal(custom.promoCode, "TREAT5");
  });

  it("catalog:csv script writes the file and prints its path, without calling Meta", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const out = join(mkdtempSync(join(tmpdir(), "catalog-")), "feed.csv");
    const script = join(__dirname, "../../../scripts/catalog-csv.ts");
    const run = spawnSync(process.execPath, ["--import", "tsx", script, "--out", out, "--link-base", "https://shop.example.in/p/"], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "" }, // no secrets: the script needs none
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), out);
    assert.match(readFileSync(out, "utf-8"), /^id,title,/);
  });
});
