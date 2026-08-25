/**
 * Self-check for the conversation engine + flow definition, run end to end
 * against a recording fake of WhatsAppClient (no real HTTP calls to Meta)
 * but a REAL Postgres for sessions/messages/applications/tokens — that's
 * the whole point of this phase, so this is an integration check, not a
 * pure unit test. Requires local Postgres running and migrated+seeded:
 *
 *   docker compose up -d
 *   pnpm --filter db migrate
 *   pnpm --filter db seed
 *   pnpm --filter bot test
 *
 * The fake only overrides WhatsAppClient's protected `post` (the network
 * call) — every send* method runs for real, including its validation
 * (button/row counts, title length limits). That's deliberate: it's
 * exactly what let a too-long Hindi list row title slip through to a live
 * 400 from Meta undetected before.
 *
 * Not a test framework — just assertions, run directly. Sets fake env vars
 * before importing anything that reads config.ts, since config validation
 * runs eagerly at import time.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "../whatsapp/types";

process.env.WHATSAPP_TOKEN ??= "test-token";
process.env.PHONE_NUMBER_ID ??= "test-phone-id";
process.env.VERIFY_TOKEN ??= "test-verify-token";
process.env.WEB_FORM_URL ??= "https://example.com/form";
process.env.BANNER_IMAGE_URL ??= "https://example.com/banner.png";
process.env.DATABASE_URL ??=
  "postgresql://uttarakhand_bot:uttarakhand_bot@localhost:5432/uttarakhand_bot?schema=public";
process.env.INTERNAL_API_SECRET ??= "test-internal-secret";
process.env.AI_SERVICE_URL ??= "https://example.com/ai";
process.env.AI_SERVICE_TOKEN ??= "test-ai-token";

// The raw Graph API request body a send* method posts — untyped here
// (matching WhatsAppClient.post's own `unknown`), read through the small
// accessors below rather than modeled field-by-field.
type Call = { to: string; type: string; [key: string]: any };

function textOf(call: Call): string {
  return call.text.body;
}
function buttonIds(call: Call): string[] {
  return call.interactive.action.buttons.map((b: any) => b.reply.id);
}
function listRowIds(call: Call): string[] {
  return call.interactive.action.sections.flatMap((s: any) => s.rows.map((r: any) => r.id));
}
function ctaUrlOf(call: Call): string {
  return call.interactive.action.parameters.url;
}

async function main() {
  const { WhatsAppClient } = await import("../whatsapp/client.js");
  const { handleIncomingMessage } = await import("./engine.js");
  const { prisma, resolveToken } = await import("db");

  class RecordingClient extends WhatsAppClient {
    calls: Call[] = [];
    protected override async post(body: unknown): Promise<unknown> {
      this.calls.push(body as Call);
      return {};
    }
  }

  function textMsg(from: string, text: string, profileName?: string): IncomingMessage {
    return { from, messageId: randomUUID(), type: "text", text, timestamp: "0", profileName };
  }
  function replyMsg(
    from: string,
    replyId: string,
    kind: "button_reply" | "list_reply" = "button_reply",
  ): IncomingMessage {
    return { from, messageId: randomUUID(), type: kind, replyId, replyTitle: replyId, timestamp: "0" };
  }

  const client = new RecordingClient();
  const user = "911111111111";
  const last = () => client.calls[client.calls.length - 1]!;

  const optOutUser = "922222222222";
  const idleUser = "933333333333";
  const downloadUser = "944444444444";
  const guardUser = "955555555555";

  // Clean slate: this suite is run repeatedly against a persistent DB.
  await prisma.session.deleteMany({
    where: { userId: { in: [user, optOutUser, idleUser, downloadUser, guardUser] } },
  });

  // 1. Unknown number -> ENTRY registers name, routes to WELCOME (banner + consent buttons).
  await handleIncomingMessage(textMsg(user, "hi", "Test User"), client);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0]!.type, "image");
  assert.equal(last().interactive.type, "button");
  assert.deepEqual(buttonIds(last()), ["proceed", "opt_out"]);

  // 2. Proceed -> LANGUAGE.
  await handleIncomingMessage(replyMsg(user, "proceed"), client);
  assert.deepEqual(buttonIds(last()), ["lang_en", "lang_hi"]);

  // 3. Pick English -> MAIN_MENU (list with 5 rows).
  await handleIncomingMessage(replyMsg(user, "lang_en"), client);
  assert.equal(last().interactive.type, "list");
  assert.deepEqual(listRowIds(last()), [
    "menu_apply",
    "menu_track",
    "menu_download",
    "menu_help",
    "menu_chat",
    "menu_change_language",
  ]);

  // 4. Change language mid-flow, typed as free text from MAIN_MENU itself
  // (rather than tapping the "Change Language" row) -> LANGUAGE buttons.
  // Picking Hindi re-renders MAIN_MENU in Hindi — this is also where the
  // real sendList validation runs for real, over the (shortened) Hindi row
  // titles that used to overflow WhatsApp's 24-char limit.
  await handleIncomingMessage(textMsg(user, "भाषा"), client);
  assert.equal(last().interactive.type, "button");
  assert.deepEqual(buttonIds(last()), ["lang_en", "lang_hi"]);
  await handleIncomingMessage(replyMsg(user, "lang_hi"), client);
  assert.equal(last().interactive.type, "list");
  assert.match(last().interactive.body.text, /आज हम आपकी क्या मदद कर सकते हैं/);

  // 5. Change language also works from a state that isn't MAIN_MENU, and
  // the English keyword still matches even while the UI is in Hindi — this
  // is a text *command*, independent of the copy language. Ends back on
  // English so the remaining assertions below can keep comparing English
  // strings.
  await handleIncomingMessage(replyMsg(user, "menu_apply"), client);
  assert.equal(last().interactive.type, "button"); // APPLY_CHOOSE (Hindi service buttons)
  await handleIncomingMessage(textMsg(user, "language"), client);
  assert.deepEqual(buttonIds(last()), ["lang_en", "lang_hi"]);
  await handleIncomingMessage(replyMsg(user, "lang_en"), client);
  assert.equal(last().interactive.type, "list");

  // 6. Apply -> choose Birth -> APPLY_HANDOFF sends a CTA url with the right
  // query params + a back-to-menu button, AND persists a HandoffToken row.
  await handleIncomingMessage(replyMsg(user, "menu_apply"), client);
  await handleIncomingMessage(replyMsg(user, "service_birth"), client);
  const ctaCall = client.calls[client.calls.length - 2]!;
  assert.equal(ctaCall.interactive.type, "cta_url");
  const urlMatch = ctaUrlOf(ctaCall).match(
    /^https:\/\/example\.com\/form\/apply\?service=birth&token=([^&]+)&lang=en&n=Test%20User$/,
  );
  assert.ok(urlMatch, `unexpected CTA url: ${ctaUrlOf(ctaCall)}`);
  const token = await resolveToken(urlMatch![1]!);
  assert.ok(token, "HandoffToken was not persisted");
  assert.equal(token!.mobileNumber, user);
  assert.equal(token!.service, "BIRTH");
  assert.equal(token!.language, "en");
  assert.equal(token!.applicantName, "Test User");
  assert.equal(last().interactive.type, "button");
  assert.deepEqual(buttonIds(last()), ["back_to_menu"]);

  // 7. Back to menu works globally, from any state.
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  assert.equal(last().interactive.type, "list");

  // 8. Track status against a seeded reference -> reports the real status.
  await handleIncomingMessage(replyMsg(user, "menu_track"), client);
  assert.equal(last().type, "text");
  await handleIncomingMessage(textMsg(user, "uk-birth-000001"), client);
  // Matched on the meaningful parts (reference + status), not the exact
  // prose/emoji wrapping — that's presentation, not the behavior under test.
  const foundText = textOf(client.calls[client.calls.length - 2]!);
  assert.match(foundText, /UK-BIRTH-000001/);
  assert.match(foundText, /Submitted/);

  // 9. Track status against an unknown reference -> a graceful not-found message.
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(user, "menu_track"), client);
  await handleIncomingMessage(textMsg(user, "UK-BIRTH-999999"), client);
  const notFoundText = textOf(client.calls[client.calls.length - 2]!);
  assert.match(notFoundText, /UK-BIRTH-999999/);
  assert.match(notFoundText, /couldn't find/);

  // 10. Restart, typed as free text ("hi"), works mid-flow — even while
  // TRACK_ASK is expecting a reference number, "hi" is treated as a
  // restart command, not a (nonsensical) reference lookup.
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(user, "menu_track"), client);
  await handleIncomingMessage(textMsg(user, "hi"), client);
  assert.equal(client.calls[client.calls.length - 2]!.type, "image"); // WELCOME banner again
  assert.deepEqual(buttonIds(last()), ["proceed", "opt_out"]);
  // Re-onboard so the remaining steps can resume from MAIN_MENU as before.
  await handleIncomingMessage(replyMsg(user, "proceed"), client);
  await handleIncomingMessage(replyMsg(user, "lang_en"), client);
  assert.equal(last().interactive.type, "list");

  // 11. The "change language" keyword is ignored before WELCOME's consent
  // buttons have been tapped — otherwise it would let a brand-new number
  // skip consent entirely on its way to LANGUAGE. Falls through to the
  // ordinary fallback instead, re-showing WELCOME's own buttons.
  await handleIncomingMessage(textMsg(guardUser, "hi", "Guard User"), client);
  const beforeGuard = client.calls.length;
  await handleIncomingMessage(textMsg(guardUser, "language"), client);
  // Fallback text, then WELCOME's own onEnter re-runs in full (banner image + buttons).
  assert.equal(client.calls.length - beforeGuard, 3);
  assert.equal(client.calls[beforeGuard]!.type, "text");
  assert.match(textOf(client.calls[beforeGuard]!), /didn.t.{0,10}understand/);
  assert.equal(client.calls[beforeGuard + 1]!.type, "image");
  assert.deepEqual(buttonIds(last()), ["proceed", "opt_out"]); // still WELCOME, not LANGUAGE

  // 12. Unrecognized free text at MAIN_MENU triggers fallback + re-shows the menu.
  const before = client.calls.length;
  await handleIncomingMessage(textMsg(user, "asdf gibberish"), client);
  assert.equal(client.calls.length - before, 2);
  assert.equal(client.calls[before]!.type, "text");
  assert.match(textOf(client.calls[before]!), /didn.t.{0,10}understand/);
  assert.equal(last().interactive.type, "list");

  // 13. Opt out, then any later message restarts at WELCOME.
  await handleIncomingMessage(textMsg(optOutUser, "hi"), client);
  await handleIncomingMessage(replyMsg(optOutUser, "opt_out"), client);
  assert.equal(last().type, "text");
  await handleIncomingMessage(textMsg(optOutUser, "hello again"), client);
  assert.deepEqual(buttonIds(last()), ["proceed", "opt_out"]);

  // 14. Idle reset: a session quiet for longer than SESSION_IDLE_MINUTES
  // restarts at WELCOME instead of resuming mid-flow, even though it never opted out.
  await handleIncomingMessage(textMsg(idleUser, "hi"), client);
  await handleIncomingMessage(replyMsg(idleUser, "proceed"), client);
  await handleIncomingMessage(replyMsg(idleUser, "lang_en"), client);
  assert.equal(last().interactive.type, "list"); // sitting at MAIN_MENU

  const idleMinutes = Number(process.env.SESSION_IDLE_MINUTES ?? 30);
  await prisma.session.update({
    where: { userId: idleUser },
    data: { lastInboundAt: new Date(Date.now() - (idleMinutes + 1) * 60_000) },
  });
  await handleIncomingMessage(replyMsg(idleUser, "menu_apply"), client);
  assert.equal(client.calls[client.calls.length - 2]!.type, "image"); // WELCOME banner again
  assert.deepEqual(buttonIds(last()), ["proceed", "opt_out"]);

  // 15. Download: nothing ready yet for a user with no applications.
  await handleIncomingMessage(replyMsg(user, "menu_download"), client);
  assert.equal(client.calls[client.calls.length - 2]!.type, "text");
  assert.match(textOf(client.calls[client.calls.length - 2]!), /not available for download/);

  // 16. Download: an approved application with a stored PDF sends it. Uses
  // a fixed, upserted reference number rather than createApplication() —
  // that helper's generateReferenceNumber is a documented count-based
  // simplification (see packages/db/src/applications.ts) that isn't safe
  // against concurrent writes, which this repeatable test shouldn't rely on.
  await prisma.certificateApplication.upsert({
    where: { referenceNumber: "UK-TEST-DOWNLOAD-000001" },
    create: {
      referenceNumber: "UK-TEST-DOWNLOAD-000001",
      type: "BIRTH",
      status: "APPROVED",
      applicantName: "Download Test",
      mobileNumber: downloadUser,
      language: "en",
      formData: {},
      certificatePdfPath: "https://example.com/certs/test.pdf",
      reviewedAt: new Date(),
    },
    update: {
      status: "APPROVED",
      mobileNumber: downloadUser,
      certificatePdfPath: "https://example.com/certs/test.pdf",
      reviewedAt: new Date(),
    },
  });
  await handleIncomingMessage(textMsg(downloadUser, "hi"), client);
  await handleIncomingMessage(replyMsg(downloadUser, "proceed"), client);
  await handleIncomingMessage(replyMsg(downloadUser, "lang_en"), client);
  await handleIncomingMessage(replyMsg(downloadUser, "menu_download"), client);
  assert.equal(client.calls[client.calls.length - 3]!.type, "text");
  assert.match(textOf(client.calls[client.calls.length - 3]!), /certificate is ready/);
  assert.equal(client.calls[client.calls.length - 2]!.type, "document");
  assert.equal(client.calls[client.calls.length - 2]!.document.link, "https://example.com/certs/test.pdf");
  assert.equal(last().interactive.type, "button");

  // 17. "Chat with us" hands the conversation to the external AI service
  // (ai-handoff-contract.html). First entry shows the one-time
  // automated-assistant disclosure.
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(user, "menu_chat"), client);
  assert.equal(last().type, "text");
  assert.match(textOf(last()), /automated assistant/);

  // converseWithAi calls the global fetch directly — there's no protected
  // seam like WhatsAppClient's `post` to override here, so stub fetch
  // itself for the AI-turn scenarios below.
  const originalFetch = globalThis.fetch;
  let capturedRequest: any;
  globalThis.fetch = (async (_url: string, init: any) => {
    capturedRequest = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        contractVersion: "1.0",
        requestId: capturedRequest.requestId,
        conversationId: capturedRequest.conversationId,
        messages: [
          { type: "text", text: "Here is how to apply." },
          {
            type: "buttons",
            body: "Anything else?",
            buttons: [{ id: "sys:apply", title: "Apply now" }],
          },
        ],
        control: { action: "continue", reason: null },
        meta: { intent: "faq_how_to_apply", confidence: 0.9 },
      }),
    };
  }) as typeof fetch;

  await handleIncomingMessage(
    textMsg(user, "How do I apply for a domicile certificate?"),
    client,
  );
  assert.equal(capturedRequest.context.entryPoint, "menu_chat_with_us");
  assert.equal(capturedRequest.message.text, "How do I apply for a domicile certificate?");
  assert.equal(client.calls[client.calls.length - 2]!.type, "text");
  assert.match(textOf(client.calls[client.calls.length - 2]!), /how to apply/);
  assert.equal(last().interactive.type, "button");
  // The AI's own button plus our guaranteed escape hatch, merged into the same block.
  assert.deepEqual(buttonIds(last()), ["sys:apply", "back_to_menu"]);

  // 18. A reserved sys:* id is intercepted, never forwarded to the AI, and
  // routes straight into the matching deterministic menu.
  await handleIncomingMessage(replyMsg(user, "sys:apply"), client);
  assert.equal(last().interactive.type, "button");
  assert.deepEqual(buttonIds(last()), ["service_birth", "service_death", "service_domicile"]);

  // 19. An apply-intent shortcut (the AI already knows the certificate
  // type) skips the picker entirely and mints a real application-form
  // link — this is the fix for "AI gives steps, we also return the apply
  // form URL" instead of forcing a redundant re-selection.
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(user, "menu_chat"), client);
  await handleIncomingMessage(textMsg(user, "How do I apply for a domicile certificate?"), client);
  await handleIncomingMessage(replyMsg(user, "sys:apply_domicile"), client);
  const domicileCtaCall = client.calls[client.calls.length - 2]!;
  assert.equal(domicileCtaCall.interactive.type, "cta_url");
  assert.match(ctaUrlOf(domicileCtaCall), /service=domicile/);
  assert.equal(last().interactive.type, "button");
  assert.deepEqual(buttonIds(last()), ["back_to_menu"]);

  // 20. AI service failures fall back gracefully — never a raw error — and
  // hand back to the main menu.
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(user, "menu_chat"), client);
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  await handleIncomingMessage(textMsg(user, "are you there?"), client);
  const fallbackCall = client.calls[client.calls.length - 2]!;
  assert.equal(fallbackCall.interactive.type, "button");
  assert.match(fallbackCall.interactive.body.text, /trouble responding/);
  assert.equal(last().interactive.type, "list"); // handed back to MAIN_MENU

  globalThis.fetch = originalFetch;

  await prisma.$disconnect();
  console.log(`ok — ${client.calls.length} messages sent across the full flow`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
