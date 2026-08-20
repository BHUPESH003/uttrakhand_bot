import { pingDatabase } from "db";
import { config } from "./config";
import { buildServer } from "./server";

const app = buildServer();

// Comfortably under Neon free tier's ~5-minute compute auto-suspend — this
// process runs 24/7 already, so it's the cheapest place to keep the DB
// warm for every consumer (bot, web, admin all share the same Neon
// project). Harmless — just a slightly wasted query — against an
// always-on Postgres.
const HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000;

function startDatabaseHeartbeat(): void {
  const ping = () =>
    pingDatabase().catch((err) => app.log.warn({ err }, "database heartbeat failed"));
  ping();
  setInterval(ping, HEARTBEAT_INTERVAL_MS);
}

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then((address) => {
    app.log.info(`Bot listening on ${address}`);
    startDatabaseHeartbeat();
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
