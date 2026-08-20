# Uttarakhand WhatsApp Bot

A WhatsApp bot demo for a Uttarakhand government service, built on Meta's
WhatsApp Cloud API.

## Stack

- pnpm workspaces monorepo (NOT turborepo — plain `pnpm -r` / `--filter`)
- TypeScript everywhere, Node 20+
- `apps/bot`: Fastify server, the WhatsApp webhook + client

## Layout

```
apps/bot/src/
  config.ts          # env var loading + zod validation
  whatsapp/client.ts  # generic WhatsApp Cloud API client (no conversation logic)
  whatsapp/types.ts   # raw Meta webhook types + our normalized IncomingMessage
  whatsapp/parse.ts   # raw webhook body -> IncomingMessage[]
  routes/webhook.ts   # GET verify handshake, POST message handling
  server.ts           # Fastify app + route registration
  index.ts            # entrypoint, starts listening
```

`packages/` is empty for now — reserved for phase 2 (see below). The
workspace glob already includes it; nothing needs to change when it's added.

## Phase plan

- **Phase 1 (current):** repo scaffold + a webhook that echoes back whatever
  the user sends (text, or the title of a tapped button/list row).
- **Phase 2+:** actual conversation flow for the government service
  (claim/service selection, forms, status lookups). Shared logic likely
  moves into `packages/*` at that point so it isn't locked into `apps/bot`.

## Conventions

- `whatsapp/client.ts` stays generic and reusable — it only knows how to call
  the Graph API. Anything that decides *what* to say belongs in routes/ or
  (later) a conversation layer, never in the client.
- Webhook POST handler always returns 200 fast; message processing
  (mark-as-read + reply) happens without blocking that response, and errors
  there are logged, not thrown back at Meta.
