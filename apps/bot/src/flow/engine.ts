/**
 * Generic conversation engine. Knows how to load a session, run a state's
 * handleInput/onEnter, translate OutgoingAction -> real WhatsAppClient
 * calls, and save the session back — nothing here knows what a "menu" or
 * "certificate" is. All of that lives in flow/definition.ts.
 *
 * The two GLOBAL rules below (back-to-menu, unrecognized-input fallback)
 * are enforced here rather than duplicated in every state, per the flow
 * spec — they still only reference *constants* the definition file
 * exports (MAIN_MENU_STATE_KEY, ENTRY_STATE_KEY), never a hardcoded menu
 * shape.
 */
import { logMessage } from "db";
import { config } from "../config";
import { whatsAppClient, type WhatsAppClient } from "../whatsapp/client";
import type { IncomingMessage } from "../whatsapp/types";
import { sessionStore, type Session } from "../session/store";
import {
  flowStates,
  ENTRY_STATE_KEY,
  LANGUAGE_STATE_KEY,
  MAIN_MENU_STATE_KEY,
  TRACK_ASK_STATE_KEY,
  BACK_TO_MENU_ID,
  TRACK_STATUS_ID,
  handleEntry,
  matchGlobalTextCommand,
} from "./definition";
import { resolveCopy, type CopyKey, type Lang } from "./copy";
import type { FlowContext, OutgoingAction } from "./types";

function makeT(session: Session) {
  return (key: CopyKey, vars?: Record<string, string>) =>
    resolveCopy(session.data.lang as Lang | undefined, key, vars);
}

async function executeAction(
  client: WhatsAppClient,
  to: string,
  action: OutgoingAction,
): Promise<void> {
  switch (action.kind) {
    case "sendText":
      await client.sendText(to, action.text);
      break;
    case "sendImage":
      await client.sendImage(to, action.imageUrl, action.caption);
      break;
    case "sendDocument":
      await client.sendDocument(to, action.documentUrl, action.filename, action.caption);
      break;
    case "sendReplyButtons":
      await client.sendReplyButtons(to, action.body, action.buttons);
      break;
    case "sendList":
      await client.sendList(to, action.body, action.buttonText, action.sections);
      break;
    case "sendCtaUrl":
      await client.sendCtaUrl(to, action.body, action.buttonText, action.url, action.headerText);
      break;
  }

  // Audit trail, mirroring the reference bot's MessageHistory /
  // MetaAuditDetail tables. Logged only after a successful send — if the
  // client call above threw, there's nothing to record as sent.
  await logMessage({
    mobileNumber: to,
    direction: "OUTGOING",
    type: action.kind,
    status: "sent",
    payload: action,
  });
}

/** Runs onEnter for `stateKey` and updates session.currentStateKey to match. */
async function enterState(
  client: WhatsAppClient,
  session: Session,
  message: IncomingMessage,
  stateKey: string,
): Promise<void> {
  // Falls back to ENTRY_STATE_KEY if a state key doesn't exist (e.g. a typo
  // introduced while editing definition.ts) instead of crashing the webhook.
  // The `!` is safe: ENTRY_STATE_KEY is guaranteed present in flowStates.
  const state = flowStates[stateKey] ?? flowStates[ENTRY_STATE_KEY]!;
  const ctx: FlowContext = { session, message, t: makeT(session) };

  for (const action of await state.onEnter(ctx)) {
    await executeAction(client, session.userId, action);
  }

  session.currentStateKey = state.key;
}

/** Fresh session data for a number we're treating as new — either truly new, or idle long enough to restart. */
function startFresh(userId: string, message: IncomingMessage, now: Date): Session {
  return {
    userId,
    currentStateKey: ENTRY_STATE_KEY,
    data: handleEntry(message),
    lastInboundAt: now,
    updatedAt: now,
  };
}

export async function handleIncomingMessage(
  message: IncomingMessage,
  client: WhatsAppClient = whatsAppClient,
): Promise<void> {
  const now = new Date();

  await logMessage({
    mobileNumber: message.from,
    direction: "INCOMING",
    type: message.type,
    status: "received",
    payload: message,
    waMessageId: message.messageId,
  });

  const existing = await sessionStore.getSession(message.from);

  const idleMinutes = existing
    ? (now.getTime() - existing.lastInboundAt.getTime()) / 60_000
    : 0;
  const idleTimedOut = existing !== undefined && idleMinutes > config.SESSION_IDLE_MINUTES;

  // No session, or one that's gone idle too long -> ENTRY: (re)register the
  // number, stash their WhatsApp display name, fall straight into WELCOME.
  if (!existing || idleTimedOut) {
    const session = startFresh(message.from, message, now);
    await enterState(client, session, message, ENTRY_STATE_KEY);
    session.updatedAt = new Date();
    await sessionStore.saveSession(session);
    return;
  }

  const session: Session = { ...existing, lastInboundAt: now };

  // GLOBAL: "Back to Main Menu" always wins, regardless of current state.
  // Then free-text commands ("hi" to restart, "language" to switch) — also
  // regardless of state, so they work even when the current state isn't
  // showing a button for them (e.g. mid-way through APPLY_CHOOSE). These
  // run before the current state ever sees the message, so a state's own
  // handleInput never needs to special-case them.
  const globalCommand =
    message.type === "text" && message.text ? matchGlobalTextCommand(message.text) : null;
  // Guards the WELCOME consent gate: before a language is chosen, the user
  // hasn't proceeded past consent yet, so "language" shouldn't skip ahead
  // of it. RESTART has no such guard — jumping back to WELCOME can never
  // bypass anything.
  const hasOnboarded = session.data.lang !== undefined;

  let nextKey: string | null;
  if (message.replyId === BACK_TO_MENU_ID) {
    nextKey = MAIN_MENU_STATE_KEY;
  } else if (message.replyId === TRACK_STATUS_ID) {
    // Global, like back-to-menu — this is also the id on the "Track
    // Status" button sent on the submission-confirmation message, tapped
    // from whatever state the session happens to be sitting in.
    nextKey = TRACK_ASK_STATE_KEY;
  } else if (globalCommand === "RESTART") {
    nextKey = ENTRY_STATE_KEY;
  } else if (globalCommand === "CHANGE_LANGUAGE" && hasOnboarded) {
    nextKey = LANGUAGE_STATE_KEY;
  } else {
    const currentState = flowStates[session.currentStateKey] ?? flowStates[ENTRY_STATE_KEY]!;
    nextKey = await currentState.handleInput({ session, message, t: makeT(session) });
  }

  // GLOBAL: unrecognized input -> friendly fallback, then re-show whatever
  // menu the user was already looking at.
  if (nextKey === null) {
    const fallbackText = makeT(session)("fallback_body");
    await executeAction(client, session.userId, { kind: "sendText", text: fallbackText });
    nextKey = session.currentStateKey;
  }

  await enterState(client, session, message, nextKey);
  session.updatedAt = new Date();
  await sessionStore.saveSession(session);
}
