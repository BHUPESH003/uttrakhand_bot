import Fastify from "fastify";
import { registerWebhookRoutes } from "./routes/webhook";
import { registerInternalRoutes } from "./routes/internal";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/", async () => ({ status: "ok" }));

  registerWebhookRoutes(app);
  registerInternalRoutes(app);

  return app;
}
