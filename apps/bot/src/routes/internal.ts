/**
 * Internal-only endpoint for apps/admin to call after approving an
 * application. Keeps ALL WhatsApp logic (window check, message sends, the
 * audit log) inside the bot service — admin just tells us an
 * applicationId got approved.
 */
import type { FastifyInstance } from "fastify";
import { getApplicationById, isWithinWindow, logMessage } from "db";
import { config } from "../config";
import { whatsAppClient } from "../whatsapp/client";
import { resolveCopy, type Lang } from "../flow/copy";
import { sessionStore } from "../session/store";
import { MAIN_MENU_STATE_KEY, TRACK_STATUS_ID, BACK_TO_MENU_ID } from "../flow/definition";

interface NotifyApprovedBody {
  applicationId?: unknown;
}

interface NotifySubmittedBody {
  applicationId?: unknown;
}

export function registerInternalRoutes(app: FastifyInstance): void {
  app.post<{ Body: NotifySubmittedBody }>("/internal/notify-submitted", async (request, reply) => {
    if (request.headers["x-internal-secret"] !== config.INTERNAL_API_SECRET) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { applicationId } = request.body ?? {};
    if (typeof applicationId !== "string" || !applicationId) {
      return reply.status(400).send({ error: "applicationId is required" });
    }

    const application = await getApplicationById(applicationId);
    if (!application) {
      return reply.status(404).send({ error: "Application not found" });
    }
    if (!application.mobileNumber) {
      return reply.status(400).send({ error: "Application has no mobile number on file" });
    }

    const to = application.mobileNumber;

    // The user just left the flow mid-APPLY_HANDOFF to fill the web form,
    // and never sends the bot another message before this notification
    // lands — so their session is still parked there. Left alone, their
    // very next message (even "Okay") would hit APPLY_HANDOFF's own
    // handleInput (always null), fall through to the engine's fallback,
    // and re-enter APPLY_HANDOFF — re-minting a token and re-sending the
    // "fill the form" CTA as if they'd never submitted anything. Reset to
    // the main menu now, regardless of whether the notify below succeeds.
    const session = await sessionStore.getSession(to);
    if (session) {
      session.currentStateKey = MAIN_MENU_STATE_KEY;
      await sessionStore.saveSession(session);
    }

    if (!(await isWithinWindow(to))) {
      return reply.status(200).send({
        status: "outside_window",
        message:
          "Outside the 24h WhatsApp free-form window — a template message is required to notify this user.",
      });
    }

    const lang = application.language as Lang;
    const text = resolveCopy(lang, "submission_confirmed_body", {
      reference: application.referenceNumber,
    });
    const buttons = [
      { id: TRACK_STATUS_ID, title: resolveCopy(lang, "menu_track") },
      { id: BACK_TO_MENU_ID, title: resolveCopy(lang, "back_to_menu") },
    ];
    await whatsAppClient.sendReplyButtons(to, text, buttons);
    await logMessage({
      mobileNumber: to,
      direction: "OUTGOING",
      type: "sendReplyButtons",
      status: "sent",
      payload: { kind: "sendReplyButtons", body: text, buttons },
    });

    return reply.status(200).send({ status: "sent" });
  });

  app.post<{ Body: NotifyApprovedBody }>("/internal/notify-approved", async (request, reply) => {
    if (request.headers["x-internal-secret"] !== config.INTERNAL_API_SECRET) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { applicationId } = request.body ?? {};
    if (typeof applicationId !== "string" || !applicationId) {
      return reply.status(400).send({ error: "applicationId is required" });
    }

    const application = await getApplicationById(applicationId);
    if (!application) {
      return reply.status(404).send({ error: "Application not found" });
    }
    if (!application.mobileNumber) {
      return reply.status(400).send({ error: "Application has no mobile number on file" });
    }
    if (!application.certificatePdfPath) {
      return reply.status(400).send({ error: "Application has no certificate PDF" });
    }

    const to = application.mobileNumber;

    if (!(await isWithinWindow(to))) {
      return reply.status(200).send({
        status: "outside_window",
        message:
          "Outside the 24h WhatsApp free-form window — a template message is required to notify this user.",
      });
    }

    const text = resolveCopy(application.language as Lang, "certificate_ready_body");
    await whatsAppClient.sendText(to, text);
    await logMessage({
      mobileNumber: to,
      direction: "OUTGOING",
      type: "sendText",
      status: "sent",
      payload: { kind: "sendText", text },
    });

    await whatsAppClient.sendDocument(
      to,
      application.certificatePdfPath,
      `${application.referenceNumber}.pdf`,
    );
    await logMessage({
      mobileNumber: to,
      direction: "OUTGOING",
      type: "sendDocument",
      status: "sent",
      payload: { kind: "sendDocument", documentUrl: application.certificatePdfPath },
    });

    return reply.status(200).send({ status: "sent" });
  });
}
