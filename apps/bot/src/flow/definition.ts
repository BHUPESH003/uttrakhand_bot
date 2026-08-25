/**
 * THE FLOW. This is the one file to edit for menu changes: add a state,
 * reorder MAIN_MENU rows, change routing — none of it touches engine.ts.
 *
 * Every state is data: `onEnter` returns a list of OutgoingAction (what to
 * send), `handleInput` reads the incoming message and returns the next
 * state's key (or null to trigger the engine's fallback-and-re-show).
 *
 * IDs used on buttons/list rows below (e.g. "proceed", "menu_apply") are
 * the routing keys the engine reads back from the webhook — see
 * whatsapp/parse.ts (IncomingMessage.replyId) and Meta's docs for why:
 * whatever `id` you send on a button/row is echoed back verbatim on tap.
 */
import { randomUUID } from "node:crypto";
import {
  createToken,
  getApplicationByReference,
  type ApplicationStatus,
} from "db";
import type { Service } from "types";
import { config } from "../config";
import type { IncomingMessage } from "../whatsapp/types";
import type { CopyKey } from "./copy";
import type { FlowContext, FlowState } from "./types";

/** No-session entry point: register the number under its WhatsApp display name. Mirrors the reference bot's CheckDevoteeAction — no login/account gate here. */
export function handleEntry(message: IncomingMessage): Record<string, unknown> {
  return { name: message.profileName ?? "" };
}

export const ENTRY_STATE_KEY = "WELCOME";
export const LANGUAGE_STATE_KEY = "LANGUAGE";
export const MAIN_MENU_STATE_KEY = "MAIN_MENU";
export const TRACK_ASK_STATE_KEY = "TRACK_ASK";
export const APPLY_CHOOSE_STATE_KEY = "APPLY_CHOOSE";
export const APPLY_HANDOFF_STATE_KEY = "APPLY_HANDOFF";
export const DOWNLOAD_STATE_KEY = "DOWNLOAD";
export const AI_CHAT_STATE_KEY = "AI_CHAT";
export const BACK_TO_MENU_ID = "back_to_menu";
// Same id as MAIN_MENU's "Track Status" row — reused as a button on the
// submission-confirmation message too, and handled globally (see engine.ts)
// so tapping it works no matter what state the session is actually in.
export const TRACK_STATUS_ID = "menu_track";

/**
 * Typed anytime, from any state, restart the conversation from WELCOME —
 * the "just send Hi" escape hatch. Recognized on the first word only (so
 * "hi there" or "hello!" still match) after lowercasing and stripping
 * punctuation.
 */
const RESTART_KEYWORDS = new Set([
  "hi",
  "hello",
  "hey",
  "start",
  "restart",
  "reset",
  "नमस्ते",
  "हाय",
  "हेलो",
  "शुरू",
]);

/**
 * Typed anytime, from any state, to jump to language selection — this is
 * what makes "change language mid-flow" work from a state (e.g.
 * APPLY_CHOOSE, TRACK_ASK) that isn't showing a dedicated button for it.
 * MAIN_MENU also offers this as a regular list row for discoverability.
 */
const LANGUAGE_KEYWORDS = new Set(["language", "lang", "भाषा"]);

function firstWord(text: string): string {
  // \p{M} (combining marks) matters here as much as \p{L}/\p{N} — Devanagari
  // vowel signs (matras) like "ा" are category Mark, not Letter, so without
  // it this strips them and mangles words (भाषा -> भष).
  return (text.trim().split(/\s+/)[0] ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

export type GlobalTextCommand = "RESTART" | "CHANGE_LANGUAGE";

/**
 * Free-text commands the engine checks BEFORE handing input to the current
 * state's handleInput — these work regardless of what buttons/rows that
 * state currently has on screen. Returns null for ordinary text (e.g. a
 * reference number on TRACK_ASK), which falls through to normal handling.
 */
export function matchGlobalTextCommand(text: string): GlobalTextCommand | null {
  const word = firstWord(text);
  if (RESTART_KEYWORDS.has(word)) return "RESTART";
  if (LANGUAGE_KEYWORDS.has(word)) return "CHANGE_LANGUAGE";
  return null;
}

const SERVICE_SLUG: Record<Service, string> = {
  BIRTH: "birth",
  DEATH: "death",
  DOMICILE: "domicile",
};
const SERVICE_COPY_KEY = {
  BIRTH: "birth_certificate",
  DEATH: "death_certificate",
  DOMICILE: "domicile_certificate",
} as const;

/** How long a handoff link stays valid before the web form should refuse it. */
const HANDOFF_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const STATUS_COPY_KEY: Record<ApplicationStatus, CopyKey> = {
  SUBMITTED: "status_submitted",
  UNDER_REVIEW: "status_under_review",
  APPROVED: "status_approved",
  REJECTED: "status_rejected",
};

function statusText(
  ctx: FlowContext,
  status: ApplicationStatus,
  rejectionReason: string | null,
) {
  const label = ctx.t(STATUS_COPY_KEY[status]);
  return status === "REJECTED" && rejectionReason
    ? `${label} (${rejectionReason})`
    : label;
}

/** Every state other than WELCOME/OPTED_OUT ends its menu with this — one button, routed by the engine's global back-to-menu rule. Exported for flow/aiChat.ts, which appends the same escape hatch to every AI turn (see the contract's "guarantee the escape hatch ourselves" recommendation). */
export function backToMenuButton(ctx: FlowContext) {
  return {
    kind: "sendReplyButtons" as const,
    body: ctx.t("back_to_menu"),
    buttons: [{ id: BACK_TO_MENU_ID, title: ctx.t("back_to_menu") }],
  };
}

export const flowStates: Record<string, FlowState> = {
  WELCOME: {
    key: "WELCOME",
    onEnter: (ctx) => [
      { kind: "sendImage", imageUrl: config.BANNER_IMAGE_URL },
      {
        kind: "sendReplyButtons",
        body: ctx.t("welcome_body"),
        buttons: [
          { id: "proceed", title: ctx.t("proceed") },
          { id: "opt_out", title: ctx.t("opt_out") },
        ],
      },
    ],
    handleInput: (ctx) => {
      if (ctx.message.replyId === "proceed") {
        // Sticks on session.data, which idle/restart re-entry (engine.ts)
        // checks before deciding whether to show this consent screen again
        // — once given, never re-asked for this number.
        ctx.session.data.consented = true;
        return LANGUAGE_STATE_KEY;
      }
      if (ctx.message.replyId === "opt_out") return "OPTED_OUT";
      return null;
    },
  },

  LANGUAGE: {
    key: LANGUAGE_STATE_KEY,
    onEnter: (ctx) => [
      {
        kind: "sendReplyButtons",
        body: ctx.t("language_prompt"),
        buttons: [
          { id: "lang_en", title: ctx.t("lang_en") },
          { id: "lang_hi", title: ctx.t("lang_hi") },
        ],
      },
    ],
    handleInput: (ctx) => {
      if (ctx.message.replyId === "lang_en") {
        ctx.session.data.lang = "en";
        return MAIN_MENU_STATE_KEY;
      }
      if (ctx.message.replyId === "lang_hi") {
        ctx.session.data.lang = "hi";
        return MAIN_MENU_STATE_KEY;
      }
      return null;
    },
  },

  MAIN_MENU: {
    key: MAIN_MENU_STATE_KEY,
    // Two messages: the three most-used actions as one-tap reply buttons
    // (WhatsApp caps these at 3 — Apply/Track/Download fits exactly),
    // everything else right after in a list, rather than burying all six
    // behind one "Menu" tap.
    onEnter: (ctx) => [
      {
        kind: "sendReplyButtons",
        body: ctx.t("main_menu_body"),
        buttons: [
          { id: "menu_apply", title: ctx.t("menu_apply_button") },
          { id: TRACK_STATUS_ID, title: ctx.t("menu_track") },
          { id: "menu_download", title: ctx.t("menu_download_button") },
        ],
      },
      {
        kind: "sendList",
        body: ctx.t("main_menu_more_body"),
        buttonText: ctx.t("main_menu_more_button"),
        sections: [
          {
            rows: [
              { id: "menu_help", title: ctx.t("menu_help") },
              { id: "menu_chat", title: ctx.t("menu_chat") },
              {
                id: "menu_change_language",
                title: ctx.t("menu_change_language"),
              },
            ],
          },
        ],
      },
    ],
    handleInput: (ctx) => {
      switch (ctx.message.replyId) {
        case "menu_apply":
          return APPLY_CHOOSE_STATE_KEY;
        // "menu_track" is handled globally now (engine.ts) so the same
        // button works from the submission-confirmation message too,
        // regardless of the session's current state.
        case "menu_download":
          return DOWNLOAD_STATE_KEY;
        case "menu_help":
          return "HELP";
        case "menu_change_language":
          return LANGUAGE_STATE_KEY;
        case "menu_chat":
          return AI_CHAT_STATE_KEY;
        default:
          return null;
      }
    },
  },

  APPLY_CHOOSE: {
    key: "APPLY_CHOOSE",
    onEnter: (ctx) => [
      {
        kind: "sendReplyButtons",
        body: ctx.t("apply_choose_body"),
        buttons: [
          { id: "service_birth", title: ctx.t("birth_certificate") },
          { id: "service_death", title: ctx.t("death_certificate") },
          { id: "service_domicile", title: ctx.t("domicile_certificate") },
        ],
      },
    ],
    handleInput: (ctx) => {
      if (ctx.message.replyId === "service_birth") {
        ctx.session.data.service = "BIRTH" satisfies Service;
        return "APPLY_HANDOFF";
      }
      if (ctx.message.replyId === "service_death") {
        ctx.session.data.service = "DEATH" satisfies Service;
        return "APPLY_HANDOFF";
      }
      if (ctx.message.replyId === "service_domicile") {
        ctx.session.data.service = "DOMICILE" satisfies Service;
        return "APPLY_HANDOFF";
      }
      return null;
    },
  },

  // Mirrors the reference bot's BaseBookingLinkAction: mint a token,
  // persist it (the web form, once built, resolves it to know who's
  // filling the form out), build the web form URL, hand off via a CTA
  // button.
  APPLY_HANDOFF: {
    key: "APPLY_HANDOFF",
    onEnter: async (ctx) => {
      const service = ctx.session.data.service as Service;
      const token = randomUUID();
      ctx.session.data.token = token;

      const name = (ctx.session.data.name as string) || "";
      const lang = (ctx.session.data.lang as string) || "en";

      await createToken({
        token,
        mobileNumber: ctx.session.userId,
        service,
        language: lang,
        applicantName: name,
        expiresAt: new Date(Date.now() + HANDOFF_TOKEN_TTL_MS),
      });

      const url =
        `${config.WEB_FORM_URL}/apply?service=${SERVICE_SLUG[service]}` +
        `&token=${token}&lang=${lang}&n=${encodeURIComponent(name)}`;

      return [
        {
          kind: "sendCtaUrl",
          headerText: ctx.t("apply_handoff_header"),
          body: ctx.t("apply_handoff_body", {
            name,
            service: ctx.t(SERVICE_COPY_KEY[service]),
          }),
          buttonText: ctx.t("apply_handoff_button"),
          url,
        },
        backToMenuButton(ctx),
      ];
    },
    handleInput: () => null,
  },

  // "Chat with us" — hands the conversation to the external AI service (see
  // ai-handoff-contract.html and flow/aiChat.ts). Every message while in
  // this state is intercepted by the engine BEFORE reaching handleInput
  // below (see engine.ts's AI_CHAT branch) — handleInput here only exists
  // to satisfy the FlowState contract and is never actually called.
  AI_CHAT: {
    key: AI_CHAT_STATE_KEY,
    onEnter: (ctx) => {
      // Re-entering the SAME AI_CHAT session (control.action: "continue")
      // re-runs onEnter every turn just like any other state — this check
      // is what keeps the automated-assistant disclosure to a one-time
      // greeting instead of repeating on every reply (see the contract's
      // "disclose it's automated" compliance rule: "not on every turn,
      // just the entry point").
      if (ctx.session.currentStateKey === AI_CHAT_STATE_KEY) return [];
      // Fresh entry: mint a new conversationId — the contract mints one
      // "each time a user re-enters Chat with us", never reused across
      // sessions — and reset the turn counter that flow/aiChat.ts increments.
      ctx.session.data.aiConversationId = `conv_${randomUUID()}`;
      ctx.session.data.aiTurnNumber = 0;
      return [{ kind: "sendText", text: ctx.t("ai_chat_intro") }];
    },
    handleInput: () => null,
  },

  TRACK_ASK: {
    key: TRACK_ASK_STATE_KEY,
    onEnter: (ctx) => [{ kind: "sendText", text: ctx.t("track_ask_body") }],
    handleInput: (ctx) => {
      if (ctx.message.type === "text" && ctx.message.text) {
        ctx.session.data.referenceNumber = ctx.message.text;
        return "TRACK_RESULT";
      }
      return null;
    },
  },

  TRACK_RESULT: {
    key: "TRACK_RESULT",
    onEnter: async (ctx) => {
      const referenceNumber = (
        (ctx.session.data.referenceNumber as string) || ""
      )
        .trim()
        .toUpperCase();
      const application = await getApplicationByReference(referenceNumber);

      const text = application
        ? ctx.t("track_result_found", {
            reference: application.referenceNumber,
            status: statusText(
              ctx,
              application.status,
              application.rejectionReason,
            ),
          })
        : ctx.t("track_result_not_found", { reference: referenceNumber });

      return [{ kind: "sendText", text }, backToMenuButton(ctx)];
    },
    handleInput: () => null,
  },

  // Asks for a reference number rather than auto-serving the caller's most
  // recent application — mirrors TRACK_ASK/TRACK_RESULT below. DOWNLOAD_RESULT
  // is where ownership actually gets checked (this state just collects input).
  DOWNLOAD: {
    key: DOWNLOAD_STATE_KEY,
    onEnter: (ctx) => [{ kind: "sendText", text: ctx.t("download_ask_body") }],
    handleInput: (ctx) => {
      if (ctx.message.type === "text" && ctx.message.text) {
        ctx.session.data.downloadReferenceNumber = ctx.message.text;
        return "DOWNLOAD_RESULT";
      }
      return null;
    },
  },

  DOWNLOAD_RESULT: {
    key: "DOWNLOAD_RESULT",
    onEnter: async (ctx) => {
      const referenceNumber = (
        (ctx.session.data.downloadReferenceNumber as string) || ""
      )
        .trim()
        .toUpperCase();
      const application = await getApplicationByReference(referenceNumber);

      // Reference numbers are sequential per type ("UK-BIRTH-000123") and
      // therefore guessable — without this check, any user could type
      // someone else's number and download their certificate. A mismatch
      // gets the exact same "not found" copy as a genuinely unknown
      // reference (see track_result_not_found reuse below), so an attacker
      // can't use the response to tell "wrong number" apart from "not
      // yours" and enumerate valid references that belong to others.
      const ownedByCaller = application?.mobileNumber === ctx.session.userId;

      if (!application || !ownedByCaller) {
        return [
          { kind: "sendText", text: ctx.t("track_result_not_found", { reference: referenceNumber }) },
          backToMenuButton(ctx),
        ];
      }

      if (application.status === "APPROVED" && application.certificatePdfPath) {
        return [
          { kind: "sendText", text: ctx.t("download_ready_body") },
          {
            kind: "sendDocument",
            documentUrl: application.certificatePdfPath,
            filename: `${application.referenceNumber}.pdf`,
          },
          backToMenuButton(ctx),
        ];
      }

      return [
        {
          kind: "sendText",
          text: ctx.t("download_not_ready_body", {
            reference: application.referenceNumber,
            status: statusText(ctx, application.status, application.rejectionReason),
          }),
        },
        backToMenuButton(ctx),
      ];
    },
    handleInput: () => null,
  },

  HELP: {
    key: "HELP",
    onEnter: (ctx) => [
      { kind: "sendText", text: ctx.t("help_body") },
      backToMenuButton(ctx),
    ],
    handleInput: () => null,
  },

  OPTED_OUT: {
    key: "OPTED_OUT",
    onEnter: (ctx) => [{ kind: "sendText", text: ctx.t("opted_out_body") }],
    // Any message at all restarts the conversation from WELCOME.
    handleInput: () => ENTRY_STATE_KEY,
  },
};
