import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { config } from "./config";
import { registerWebhookRoutes } from "./routes/webhook";
import { registerInternalRoutes } from "./routes/internal";
import { registerFlowEndpointRoutes } from "./routes/flowEndpoint";
import { dataset, orderStore } from "./commerce-demo/data";
import { commerceSessions } from "./commerce-demo/sessions";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/", async () => ({ status: "ok" }));

  registerWebhookRoutes(app);
  registerInternalRoutes(app);

  // FLOW_PRIVATE_KEY (PEM in env) wins over FLOW_PRIVATE_KEY_PATH (PEM file from `pnpm demo:keys`).
  const flowKeyPem =
    config.FLOW_PRIVATE_KEY ?? (config.FLOW_PRIVATE_KEY_PATH ? readFileSync(config.FLOW_PRIVATE_KEY_PATH, "utf-8") : undefined);
  if (flowKeyPem && config.META_APP_SECRET) {
    registerFlowEndpointRoutes(app, {
      // Parsed once at boot: a bad key fails startup, not the first request.
      privateKey: createPrivateKey({ key: flowKeyPem, passphrase: config.FLOW_PRIVATE_KEY_PASSPHRASE }),
      appSecret: config.META_APP_SECRET,
      deps: { sessions: commerceSessions, dataset, orders: orderStore },
    });
  } else {
    app.log.info("commerce-demo Flow endpoint disabled (set FLOW_PRIVATE_KEY or FLOW_PRIVATE_KEY_PATH, and META_APP_SECRET)");
  }

  return app;
}
