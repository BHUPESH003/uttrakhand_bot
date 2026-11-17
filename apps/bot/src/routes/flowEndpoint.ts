/**
 * POST /flows/commerce-demo — the WhatsApp Flows data endpoint for the
 * commerce demo. Transport only: signature check, decrypt, hand the
 * plaintext to commerce-demo/flowHandler.ts, encrypt the answer.
 *
 *   432  X-Hub-Signature-256 doesn't match (app secret)
 *   421  body can't be decrypted (Meta re-fetches the public key and retries)
 *   427  flow_token unknown/expired (handler decides; sent unencrypted, per docs)
 *   200  base64 ciphertext as text/plain
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 *       https://developers.facebook.com/docs/whatsapp/flows/reference/error-codes
 */
import type { KeyObject } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { handleFlowRequest, type FlowDeps, type FlowRequest } from "../commerce-demo/flowHandler";
import {
  decryptFlowRequest,
  encryptFlowResponse,
  isEncryptedFlowRequest,
  verifyMetaSignature,
} from "../whatsapp/flowCrypto";

export const COMMERCE_FLOW_PATH = "/flows/commerce-demo";

export interface FlowEndpointOptions {
  privateKey: KeyObject;
  appSecret: string;
  deps: FlowDeps;
}

export function registerFlowEndpointRoutes(app: FastifyInstance, options: FlowEndpointOptions): void {
  // Encapsulated so only this route sees raw bytes (the signature is over the
  // exact body); /webhook keeps Fastify's normal JSON parsing.
  app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

    scope.post(COMMERCE_FLOW_PATH, async (request, reply) => {
      const started = performance.now();
      const raw = request.body as Buffer;

      if (!verifyMetaSignature(raw, request.headers["x-hub-signature-256"] as string | undefined, options.appSecret)) {
        console.warn("[flow] signature check failed -> 432");
        return reply.code(432).send();
      }

      let decrypted: ReturnType<typeof decryptFlowRequest>;
      try {
        const body: unknown = JSON.parse(raw.toString("utf-8"));
        if (!isEncryptedFlowRequest(body)) throw new Error("missing encrypted fields");
        decrypted = decryptFlowRequest(body, options.privateKey);
      } catch {
        console.warn("[flow] decryption failed -> 421");
        return reply.code(421).send();
      }

      const req = decrypted.payload as FlowRequest;
      const result = handleFlowRequest(req, options.deps);
      const ms = (performance.now() - started).toFixed(1);
      // Handler time per screen, to compare against Meta's endpoint timeout. No token/user ids.
      console.log(
        `[flow] ${req.action ?? "?"} screen=${req.screen ?? "-"} -> ${result.status === 200 ? (result.screen ?? "ok") : result.status} ${ms}ms`,
      );

      if (result.status === 427) return reply.code(427).send(result.body);
      return reply
        .code(200)
        .type("text/plain")
        .send(encryptFlowResponse(result.body, decrypted.aesKey, decrypted.iv));
    });
  });
}
