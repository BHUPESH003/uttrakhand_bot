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
  const { WhatsAppClient, WhatsAppApiError } = await import("../whatsapp/client.js");
  const { handleIncomingMessage } = await import("./engine.js");
  const { recordStatus } = await import("../whatsapp/deliveryTracker.js");
  const { prisma, resolveToken } = await import("db");

  class RecordingClient extends WhatsAppClient {
    calls: Call[] = [];
    // Voice-note tests below set this to control what getMediaInfo returns,
    // instead of stubbing global fetch — these two methods hit different
    // Graph API endpoints than post()'s /messages, so they need their own
    // seam (see whatsapp/client.ts).
    mediaInfoOverride: { url: string; mimeType: string; fileSizeBytes: number } | null = null;
    // Simulates Meta rejecting one specific message type (e.g. a bad-
    // Content-Type audio URL) — consumed after one throw so the rest of a
    // test's calls succeed normally.
    failNextPostType: string | null = null;

    protected override async post(body: unknown): Promise<unknown> {
      const call = body as Call;
      if (this.failNextPostType && call.type === this.failNextPostType) {
        this.failNextPostType = null;
        throw new WhatsAppApiError(`simulated Meta rejection of a "${call.type}" message`, 400);
      }
      this.calls.push(call);
      // Real Graph API responses look like { messages: [{ id: "wamid..." }] }
      // — sendAudio relies on this to hand a wamid to deliveryTracker.
      return call.type === "audio" ? { messages: [{ id: "test-audio-wamid" }] } : {};
    }
    override async getMediaInfo(mediaId: string) {
      if (!this.mediaInfoOverride) throw new Error(`no mediaInfoOverride set for ${mediaId}`);
      return this.mediaInfoOverride;
    }
    override async downloadMediaAsBase64(_url: string): Promise<string> {
      return Buffer.from("fake voice note bytes").toString("base64");
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
  function audioMsg(
    from: string,
    opts: { mediaId?: string; mimeType?: string; isVoiceNote?: boolean } = {},
  ): IncomingMessage {
    return {
      from,
      messageId: randomUUID(),
      type: "audio",
      mediaId: opts.mediaId ?? "media-123",
      mimeType: opts.mimeType ?? "audio/ogg; codecs=opus",
      isVoiceNote: opts.isVoiceNote ?? true,
      timestamp: "0",
    };
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

  // 3. Pick English -> MAIN_MENU: Apply/Track/Download as reply buttons,
  // then Help/Chat/Change Language as a list right after.
  await handleIncomingMessage(replyMsg(user, "lang_en"), client);
  const mainMenuButtons = client.calls[client.calls.length - 2]!;
  assert.equal(mainMenuButtons.interactive.type, "button");
  assert.deepEqual(buttonIds(mainMenuButtons), ["menu_apply", "menu_track", "menu_download"]);
  assert.equal(last().interactive.type, "list");
  assert.deepEqual(listRowIds(last()), ["menu_help", "menu_chat", "menu_change_language"]);

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
  assert.match(
    client.calls[client.calls.length - 2]!.interactive.body.text,
    /आज हम आपकी क्या मदद कर सकते हैं/,
  );

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
  // restart command, not a (nonsensical) reference lookup. `user` already
  // consented back in step 1, so this skips WELCOME entirely and goes
  // straight to LANGUAGE — consent given once is never re-asked.
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(user, "menu_track"), client);
  await handleIncomingMessage(textMsg(user, "hi"), client);
  assert.deepEqual(buttonIds(last()), ["lang_en", "lang_hi"]);
  // Re-onboard so the remaining steps can resume from MAIN_MENU as before.
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

  // 12. Unrecognized free text at MAIN_MENU triggers fallback + re-shows the
  // menu (now two messages: buttons, then list).
  const before = client.calls.length;
  await handleIncomingMessage(textMsg(user, "asdf gibberish"), client);
  assert.equal(client.calls.length - before, 3);
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
  // restarts mid-flow instead of resuming — but since idleUser already
  // consented before going idle, it restarts at LANGUAGE, not WELCOME.
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
  assert.deepEqual(buttonIds(last()), ["lang_en", "lang_hi"]); // consent carried over, WELCOME skipped
  await handleIncomingMessage(replyMsg(idleUser, "lang_en"), client); // re-onboard for later steps

  // 15. Download now asks for a reference number instead of auto-serving
  // the caller's most recent application.
  await handleIncomingMessage(replyMsg(user, "menu_download"), client);
  assert.equal(last().type, "text");
  assert.match(textOf(last()), /enter your application reference/);

  // An unknown reference gets a graceful not-found, same as Track Status.
  await handleIncomingMessage(textMsg(user, "UK-BIRTH-999999"), client);
  assert.equal(client.calls[client.calls.length - 2]!.type, "text");
  assert.match(textOf(client.calls[client.calls.length - 2]!), /couldn't find/);

  // Fixed, upserted reference numbers rather than createApplication() —
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

  // 16. Ownership is enforced: this is a real, APPROVED application with a
  // PDF — but it belongs to downloadUser, not `user`. Reference numbers are
  // sequential per type and therefore guessable, so this is the actual
  // security fix: knowing/guessing a valid reference must not be enough.
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(user, "menu_download"), client);
  await handleIncomingMessage(textMsg(user, "UK-TEST-DOWNLOAD-000001"), client);
  assert.equal(client.calls[client.calls.length - 2]!.type, "text");
  assert.match(textOf(client.calls[client.calls.length - 2]!), /couldn't find/); // not "here it is"
  assert.notEqual(last().type, "document");

  // 17. The actual owner can download their own approved certificate.
  await handleIncomingMessage(textMsg(downloadUser, "hi"), client);
  await handleIncomingMessage(replyMsg(downloadUser, "proceed"), client);
  await handleIncomingMessage(replyMsg(downloadUser, "lang_en"), client);
  await handleIncomingMessage(replyMsg(downloadUser, "menu_download"), client);
  await handleIncomingMessage(textMsg(downloadUser, "UK-TEST-DOWNLOAD-000001"), client);
  assert.equal(client.calls[client.calls.length - 3]!.type, "text");
  assert.match(textOf(client.calls[client.calls.length - 3]!), /certificate is ready/);
  assert.equal(client.calls[client.calls.length - 2]!.type, "document");
  assert.equal(client.calls[client.calls.length - 2]!.document.link, "https://example.com/certs/test.pdf");
  assert.equal(last().interactive.type, "button");

  // 18. A reference the caller owns but that isn't approved yet gets a
  // specific "not ready" message, distinct from the not-found/not-yours case.
  await prisma.certificateApplication.upsert({
    where: { referenceNumber: "UK-TEST-DOWNLOAD-PENDING-000001" },
    create: {
      referenceNumber: "UK-TEST-DOWNLOAD-PENDING-000001",
      type: "BIRTH",
      status: "UNDER_REVIEW",
      applicantName: "Pending Test",
      mobileNumber: downloadUser,
      language: "en",
      formData: {},
    },
    update: { status: "UNDER_REVIEW", mobileNumber: downloadUser, certificatePdfPath: null },
  });
  await handleIncomingMessage(replyMsg(downloadUser, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(downloadUser, "menu_download"), client);
  await handleIncomingMessage(textMsg(downloadUser, "UK-TEST-DOWNLOAD-PENDING-000001"), client);
  assert.equal(client.calls[client.calls.length - 2]!.type, "text");
  assert.match(textOf(client.calls[client.calls.length - 2]!), /Not Ready Yet/);

  // 19. "Chat with us" hands the conversation to the external AI service
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

  // 20. A reserved sys:* id is intercepted, never forwarded to the AI, and
  // routes straight into the matching deterministic menu.
  await handleIncomingMessage(replyMsg(user, "sys:apply"), client);
  assert.equal(last().interactive.type, "button");
  assert.deepEqual(buttonIds(last()), ["service_birth", "service_death", "service_domicile"]);

  // 21. An apply-intent shortcut (the AI already knows the certificate
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

  // 22. A voice note in AI_CHAT is downloaded from Meta and relayed to the
  // AI service as base64 (ai-voice-handoff-contract.html#request); an
  // `audio` response block renders as a real WhatsApp audio message. Also
  // verifies the delivery-status wait (whatsapp/deliveryTracker.ts): the
  // turn should unblock as soon as Meta's "delivered" callback for the
  // audio wamid arrives, not sit out the full AUDIO_DELIVERY_TIMEOUT_MS —
  // replacing a fixed guess-the-gap delay that a live test showed wasn't
  // reliable (buttons still rendered before the voice note).
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(user, "menu_chat"), client);
  client.mediaInfoOverride = {
    url: "https://lookaside.fbsbx.com/fake-media-url",
    mimeType: "audio/ogg; codecs=opus",
    fileSizeBytes: 50_000,
  };
  globalThis.fetch = (async (_url: string, init: any) => {
    capturedRequest = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        contractVersion: "1.1",
        requestId: capturedRequest.requestId,
        conversationId: capturedRequest.conversationId,
        messages: [{ type: "audio", audioUrl: "https://example.com/tts/reply.ogg" }],
        control: { action: "continue", reason: null },
        meta: { intent: "faq_voice", confidence: 0.88 },
      }),
    };
  }) as typeof fetch;

  const voiceTurnStarted = Date.now();
  const voiceTurnPromise = handleIncomingMessage(audioMsg(user), client);
  // Give the audio POST a beat to actually go out before simulating Meta's
  // webhook callback — RecordingClient.post() hands sendAudio a fixed
  // "test-audio-wamid" for every audio send (see its override above).
  await new Promise((resolve) => setTimeout(resolve, 50));
  recordStatus("test-audio-wamid", "delivered");
  await voiceTurnPromise;
  const voiceTurnMs = Date.now() - voiceTurnStarted;
  assert.ok(
    voiceTurnMs < 2000,
    `expected the "delivered" callback to unblock the turn quickly, took ${voiceTurnMs}ms`,
  );

  assert.equal(capturedRequest.message.type, "audio");
  assert.equal(capturedRequest.message.text, null);
  assert.equal(capturedRequest.message.audio.encoding, "base64");
  assert.equal(capturedRequest.message.audio.fileSizeBytes, 50_000);
  assert.ok(capturedRequest.message.audio.data.length > 0);
  // The audio block, then our guaranteed back-to-menu button appended after.
  const audioCall = client.calls[client.calls.length - 2]!;
  assert.equal(audioCall.type, "audio");
  assert.equal(audioCall.audio.link, "https://example.com/tts/reply.ogg");
  assert.equal(last().interactive.type, "button");
  assert.deepEqual(buttonIds(last()), ["back_to_menu"]);

  // 23. One block failing to send (e.g. Meta rejecting an audio URL served
  // with the wrong Content-Type — a real bug hit in AI-team testing)
  // doesn't take the rest of the turn down with it: the text before it and
  // the buttons after it still reach the user, instead of collapsing to
  // the generic fallback.
  globalThis.fetch = (async (_url: string, init: any) => {
    capturedRequest = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        contractVersion: "1.1",
        requestId: capturedRequest.requestId,
        conversationId: capturedRequest.conversationId,
        messages: [
          { type: "text", text: "Here is your answer." },
          { type: "audio", audioUrl: "https://example.com/tts/broken.ogg" },
          { type: "buttons", body: "Anything else?", buttons: [{ id: "sys:apply", title: "Apply now" }] },
        ],
        control: { action: "continue", reason: null },
        meta: { intent: "faq_voice", confidence: 0.9 },
      }),
    };
  }) as typeof fetch;
  client.failNextPostType = "audio";
  const beforePartialFailure = client.calls.length;
  await handleIncomingMessage(textMsg(user, "ask something"), client);
  const sentAfterPartialFailure = client.calls.slice(beforePartialFailure);
  assert.equal(sentAfterPartialFailure.length, 2); // text + buttons — audio silently skipped
  assert.equal(sentAfterPartialFailure[0]!.type, "text");
  assert.match(textOf(sentAfterPartialFailure[0]!), /Here is your answer/);
  assert.equal(sentAfterPartialFailure[1]!.type, "interactive");
  assert.deepEqual(buttonIds(sentAfterPartialFailure[1]!), ["sys:apply", "back_to_menu"]);

  // 24. A voice note over the size cap gets a graceful "too long" fallback
  // instead of being forwarded — and stays in AI_CHAT so the user can retry
  // with a shorter note or just type (ai-voice-handoff-contract.html#media-limits).
  client.mediaInfoOverride = {
    url: "https://lookaside.fbsbx.com/fake-media-url",
    mimeType: "audio/ogg; codecs=opus",
    fileSizeBytes: 5_000_000, // over the 2MB default cap
  };
  await handleIncomingMessage(audioMsg(user), client);
  assert.equal(last().interactive.type, "button");
  assert.match(last().interactive.body.text, /too long/);
  assert.deepEqual(buttonIds(last()), ["back_to_menu"]);

  // Still in AI_CHAT afterward: a normal text message keeps going to the AI
  // service, rather than falling back to MAIN_MENU's unrecognized-input
  // path. Swapped to a plain text-only stub (no audio block) — the
  // previous step's stub is still active otherwise, and its audio block
  // would now send for real (failNextPostType only fires once) with
  // nothing to resolve its delivery wait.
  capturedRequest = undefined;
  globalThis.fetch = (async (_url: string, init: any) => {
    capturedRequest = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        contractVersion: "1.1",
        requestId: capturedRequest.requestId,
        conversationId: capturedRequest.conversationId,
        messages: [{ type: "text", text: "Sure, go ahead and type your question." }],
        control: { action: "continue", reason: null },
        meta: {},
      }),
    };
  }) as typeof fetch;
  await handleIncomingMessage(textMsg(user, "never mind, typing instead"), client);
  assert.ok(capturedRequest, "expected AI_CHAT to still be active after the too-long fallback");

  // 25. A shared audio file (not an in-app voice note) is rejected with its
  // own fallback, also staying in AI_CHAT — this phase only accepts voice
  // notes recorded directly in WhatsApp.
  await handleIncomingMessage(audioMsg(user, { isVoiceNote: false }), client);
  assert.match(last().interactive.body.text, /voice notes recorded here in WhatsApp/);

  // 26. AI service failures fall back gracefully — never a raw error — and
  // hand back to the main menu.
  await handleIncomingMessage(replyMsg(user, "back_to_menu"), client);
  await handleIncomingMessage(replyMsg(user, "menu_chat"), client);
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  await handleIncomingMessage(textMsg(user, "are you there?"), client);
  // AI fallback button, then MAIN_MENU's own two messages (buttons + list).
  const fallbackCall = client.calls[client.calls.length - 3]!;
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
