/**
 * Handles one turn of the AI_CHAT state (see ai-handoff-contract.html and,
 * for voice notes, ai-voice-handoff-contract.html) — called by engine.ts
 * instead of a normal state's handleInput, because rendering the reply
 * means sending whatever the AI service just returned (a dynamic, per-turn
 * message list), not a fixed shape a FlowState's onEnter can describe up
 * front.
 *
 * Reserved `sys:*` button/row IDs are intercepted here and never reach the
 * AI service — they're how the AI hands control back into our
 * deterministic menus without knowing how those menus are built.
 */
import { randomUUID } from "node:crypto";
import { getLatestApplicationForNumber, logMessage } from "db";
import type { Service } from "types";
import { config } from "../config";
import { converseWithAi } from "../ai/client";
import type { AiConverseRequest, AiMessageBlock } from "../ai/types";
import type { WhatsAppClient } from "../whatsapp/client";
import type { IncomingMessage } from "../whatsapp/types";
import type { Session } from "../session/store";
import { executeAction } from "./actions";
import {
  AI_CHAT_STATE_KEY,
  APPLY_CHOOSE_STATE_KEY,
  APPLY_HANDOFF_STATE_KEY,
  DOWNLOAD_STATE_KEY,
  MAIN_MENU_STATE_KEY,
  TRACK_ASK_STATE_KEY,
  BACK_TO_MENU_ID,
} from "./definition";
import { resolveCopy, type CopyKey, type Lang } from "./copy";
import type { OutgoingAction } from "./types";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
// "Cap messages[] at 3 blocks per turn" — ai-handoff-contract.html#reliability.
const MAX_MESSAGE_BLOCKS = 3;

/** ai-handoff-contract.html#control-ids */
const RESERVED_CONTROL_IDS: Record<string, string> = {
  "sys:main_menu": MAIN_MENU_STATE_KEY,
  "sys:apply": APPLY_CHOOSE_STATE_KEY,
  "sys:track": TRACK_ASK_STATE_KEY,
  "sys:download": DOWNLOAD_STATE_KEY,
  "sys:end_chat": MAIN_MENU_STATE_KEY,
};

/**
 * Apply-intent shortcuts: when the AI already knows which certificate the
 * user means (they said "birth certificate", not just "apply"), it should
 * send one of these instead of generic `sys:apply` — it skips straight to
 * APPLY_HANDOFF for that type, which mints a real token and sends the
 * actual application-form link, instead of re-asking the user to pick a
 * type they already named. The AI can never construct that link itself
 * (it requires a DB-backed token only we can mint), so this reserved-id
 * hop is the only way an "apply" intent turns into the real URL.
 */
const RESERVED_APPLY_SERVICE_IDS: Record<string, Service> = {
  "sys:apply_birth": "BIRTH",
  "sys:apply_death": "DEATH",
  "sys:apply_domicile": "DOMICILE",
};

function toOutgoingAction(block: AiMessageBlock): OutgoingAction {
  switch (block.type) {
    case "text":
      return { kind: "sendText", text: block.text };
    case "buttons":
      return { kind: "sendReplyButtons", body: block.body, buttons: block.buttons };
    case "list":
      return {
        kind: "sendList",
        body: block.body,
        buttonText: block.buttonText,
        sections: block.sections,
      };
    case "cta_url":
      return {
        kind: "sendCtaUrl",
        body: block.body,
        buttonText: block.buttonText,
        url: block.url,
        headerText: block.headerText,
      };
    case "image":
      return { kind: "sendImage", imageUrl: block.imageUrl, caption: block.caption };
    case "document":
      return {
        kind: "sendDocument",
        documentUrl: block.documentUrl,
        filename: block.filename,
        caption: block.caption,
      };
    case "audio":
      return { kind: "sendAudio", audioUrl: block.audioUrl };
  }
}

/**
 * "The bot will append a Back to Menu button after each AI turn
 * automatically (merged into your own buttons, up to the 3-button cap...)"
 * — ai-handoff-contract.html#ux. One less compliance-critical thing to
 * trust every AI response to remember.
 */
function withBackToMenu(actions: OutgoingAction[], t: (key: CopyKey) => string): OutgoingAction[] {
  const backToMenu = { id: BACK_TO_MENU_ID, title: t("back_to_menu") };
  const last = actions[actions.length - 1];
  if (last?.kind === "sendReplyButtons" && last.buttons.length < 3) {
    return [...actions.slice(0, -1), { ...last, buttons: [...last.buttons, backToMenu] }];
  }
  return [...actions, { kind: "sendReplyButtons", body: t("back_to_menu"), buttons: [backToMenu] }];
}

async function sendFallback(
  client: WhatsAppClient,
  to: string,
  t: (key: CopyKey) => string,
  bodyKey: CopyKey = "ai_chat_error_body",
): Promise<void> {
  // "On any failure ... the bot sends a graceful fallback message plus a
  // sys:main_menu button — never a raw error to the user." Same button id
  // as everywhere else in this app (BACK_TO_MENU_ID), which the engine
  // already routes to MAIN_MENU globally. `bodyKey` lets voice-specific
  // callers below reuse this same shape with their own copy.
  await executeAction(client, to, {
    kind: "sendReplyButtons",
    body: t(bodyKey),
    buttons: [{ id: BACK_TO_MENU_ID, title: t("back_to_menu") }],
  });
}

/** Returns the next flow state key, same contract as FlowState.handleInput. */
export async function handleAiChatTurn(
  client: WhatsAppClient,
  session: Session,
  message: IncomingMessage,
): Promise<string | null> {
  const lang = (session.data.lang as Lang | undefined) ?? "en";
  const t = (key: CopyKey, vars?: Record<string, string>) => resolveCopy(lang, key, vars);

  if (message.replyId && message.replyId in RESERVED_APPLY_SERVICE_IDS) {
    session.data.service = RESERVED_APPLY_SERVICE_IDS[message.replyId];
    return APPLY_HANDOFF_STATE_KEY;
  }
  if (message.replyId && message.replyId in RESERVED_CONTROL_IDS) {
    return RESERVED_CONTROL_IDS[message.replyId]!;
  }

  if (
    message.type !== "text" &&
    message.type !== "button_reply" &&
    message.type !== "list_reply" &&
    message.type !== "audio"
  ) {
    // Unsupported input (image, location, ...) isn't part of the contract's
    // message shape — return null so the engine's usual fallback handles
    // it and re-shows AI_CHAT (a no-op onEnter, since we're already in it).
    return null;
  }

  // Voice notes (see ai-voice-handoff-contract.html#request): fetch the
  // bytes from Meta and inline them as base64 — the AI service can't fetch
  // Meta's media URL itself, it requires our own bearer token and expires
  // in minutes. Policy (voice-note-only, size cap) lives here rather than
  // in whatsapp/parse.ts, which stays a mechanical, policy-free normalizer.
  let audioPayload: AiConverseRequest["message"]["audio"] = null;
  if (message.type === "audio") {
    if (!message.mediaId) return null; // malformed webhook payload — generic fallback handles it

    if (!message.isVoiceNote) {
      await sendFallback(client, session.userId, t, "ai_chat_voice_unsupported");
      return AI_CHAT_STATE_KEY;
    }

    try {
      const info = await client.getMediaInfo(message.mediaId);
      if (info.fileSizeBytes > config.AI_VOICE_MAX_AUDIO_BYTES) {
        await sendFallback(client, session.userId, t, "ai_chat_voice_too_long");
        return AI_CHAT_STATE_KEY;
      }
      const data = await client.downloadMediaAsBase64(info.url);
      audioPayload = { mimeType: info.mimeType, fileSizeBytes: info.fileSizeBytes, encoding: "base64", data };
    } catch (err) {
      console.error("[ai-chat] failed to fetch voice note media", err);
      await sendFallback(client, session.userId, t);
      return MAIN_MENU_STATE_KEY;
    }
  }

  const application = await getLatestApplicationForNumber(session.userId);
  const turnNumber = ((session.data.aiTurnNumber as number | undefined) ?? 0) + 1;
  session.data.aiTurnNumber = turnNumber;

  const withinSessionWindow = Date.now() - session.lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;

  const request: AiConverseRequest = {
    contractVersion: "1.1",
    requestId: randomUUID(),
    conversationId: session.data.aiConversationId as string,
    channel: "whatsapp",
    timestamp: new Date().toISOString(),
    user: {
      waId: session.userId,
      profileName: (session.data.name as string | undefined) ?? "",
      language: lang,
    },
    whatsapp: {
      phoneNumberId: config.PHONE_NUMBER_ID,
      incomingMessageId: message.messageId,
      withinSessionWindow,
      windowExpiresAt: new Date(session.lastInboundAt.getTime() + WHATSAPP_WINDOW_MS).toISOString(),
    },
    message: {
      type: message.type,
      text: message.type === "text" ? (message.text ?? "") : null,
      replyId: message.type === "text" || message.type === "audio" ? null : (message.replyId ?? null),
      replyTitle:
        message.type === "text" || message.type === "audio" ? null : (message.replyTitle ?? null),
      audio: audioPayload,
    },
    context: {
      entryPoint: "menu_chat_with_us",
      turnNumber,
      applicant: application
        ? {
            name: application.applicantName,
            lastService: application.type,
            lastApplicationStatus: application.status,
          }
        : null,
    },
  };

  await logMessage({
    mobileNumber: session.userId,
    direction: "OUTGOING",
    type: "ai_request",
    status: "sent",
    payload: request,
  });

  let response;
  try {
    response = await converseWithAi(request);
  } catch (err) {
    console.error("[ai-chat] AI service call failed", err);
    await sendFallback(client, session.userId, t);
    return MAIN_MENU_STATE_KEY;
  }

  await logMessage({
    mobileNumber: session.userId,
    direction: "INCOMING",
    type: "ai_response",
    status: "received",
    payload: response,
  });

  let blocks = response.messages;
  if (blocks.length > MAX_MESSAGE_BLOCKS) {
    console.warn(
      `[ai-chat] AI response had ${blocks.length} message blocks, dropping ${blocks.length - MAX_MESSAGE_BLOCKS} beyond the ${MAX_MESSAGE_BLOCKS}-block cap`,
    );
    blocks = blocks.slice(0, MAX_MESSAGE_BLOCKS);
  }

  try {
    const actions = withBackToMenu(blocks.map(toOutgoingAction), t);
    for (const action of actions) {
      await executeAction(client, session.userId, action);
    }
  } catch (err) {
    // A block that violates Meta's hard limits (e.g. a 4th button, a
    // 21-char title) fails the whole send (error 131009) — same graceful
    // fallback as an outright AI service failure, never a raw error.
    console.error("[ai-chat] failed to render AI response", err);
    await sendFallback(client, session.userId, t);
    return MAIN_MENU_STATE_KEY;
  }

  if (response.control.action === "return_to_menu" || response.control.action === "end_session") {
    return MAIN_MENU_STATE_KEY;
  }
  return AI_CHAT_STATE_KEY;
}
