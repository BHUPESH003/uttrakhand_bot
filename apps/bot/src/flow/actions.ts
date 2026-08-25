/**
 * Turns one OutgoingAction into a real WhatsAppClient call plus an audit
 * log entry. Shared by the flow engine (rendering a state's onEnter) and
 * the AI_CHAT passthrough (rendering a dynamic AI response) — both need
 * the exact same send-then-log behavior.
 */
import { logMessage } from "db";
import type { WhatsAppClient } from "../whatsapp/client";
import type { OutgoingAction } from "./types";

export async function executeAction(
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
