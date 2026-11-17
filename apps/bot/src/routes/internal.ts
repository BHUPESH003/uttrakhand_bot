/**
 * Internal-only endpoint for apps/admin to call after approving an
 * application. Keeps ALL WhatsApp logic (window check, message sends, the
 * audit log) inside the bot service — admin just tells us an
 * applicationId got approved.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { getApplicationById, isWithinWindow, logMessage } from "db";
import { config } from "../config";
import { maskPhone, whatsAppClient, WhatsAppApiError } from "../whatsapp/client";
import { flowConfig, flowConfigSchema } from "../commerce-demo/config";
import { sendDemoMessage } from "../commerce-demo/journeys";
import { DemoSendBlockedError } from "../commerce-demo/sendGuard";
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

  registerDemoRoutes(app);
}

const authorized = (request: FastifyRequest) => request.headers["x-internal-secret"] === config.INTERNAL_API_SECRET;

/**
 * Commerce demo controls, same shared-secret guard as above:
 *   GET/PUT /internal/demo-config  admin page (apps/admin) reads/writes the Flow flags
 *   POST /internal/demo/send       setup scripts send a demo entry message from inside
 *                                  this process (a Flow's session must live here)
 */
function registerDemoRoutes(app: FastifyInstance): void {
  app.get("/internal/demo-config", async (request, reply) => {
    if (!authorized(request)) return reply.status(401).send({ error: "Unauthorized" });
    return reply.send({ config: flowConfig.get() });
  });

  app.put<{ Body: unknown }>("/internal/demo-config", async (request, reply) => {
    if (!authorized(request)) return reply.status(401).send({ error: "Unauthorized" });
    try {
      return reply.send({ config: flowConfig.set(flowConfigSchema.partial().strict().parse(request.body ?? {})) });
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ error: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
      }
      throw err;
    }
  });

  app.post<{ Body: { to?: unknown; kind?: unknown; brandId?: unknown; screen?: unknown; mode?: unknown } }>(
    "/internal/demo/send",
    async (request, reply) => {
      if (!authorized(request)) return reply.status(401).send({ error: "Unauthorized" });
      const { to, kind, brandId, screen, mode } = request.body ?? {};
      if (typeof to !== "string" || !/^\d{8,15}$/.test(to)) return reply.status(400).send({ error: "to must be a number like 919812345678" });
      if (kind !== "flow" && kind !== "carousel" && kind !== "catalog") {
        return reply.status(400).send({ error: "kind must be flow, carousel or catalog" });
      }
      if (screen !== undefined && screen !== "ITEM" && screen !== "OTHER_AMOUNT") {
        return reply.status(400).send({ error: "screen must be ITEM or OTHER_AMOUNT" });
      }
      if (mode !== undefined && mode !== "draft" && mode !== "published") {
        return reply.status(400).send({ error: "mode must be draft or published" });
      }
      try {
        const result = await sendDemoMessage(to, kind, {
          brandId: typeof brandId === "string" ? brandId : undefined,
          screen,
          mode,
        });
        return reply.send({ status: "sent", to: maskPhone(to), ...result });
      } catch (err) {
        // Guard blocks, validation errors and Meta errors all come back readable, never with a full number.
        const meta = err instanceof WhatsAppApiError ? { code: err.code, fbtraceId: err.fbtraceId } : {};
        return reply.status(err instanceof DemoSendBlockedError ? 403 : 502).send({
          error: err instanceof Error ? err.message : String(err),
          ...meta,
        });
      }
    },
  );
}
