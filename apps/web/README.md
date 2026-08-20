# apps/web

Next.js public form the WhatsApp bot's "Fill Application Form" CTA button
lands on. Reads `?service=birth|death&token=...&lang=en|hi&n=...` from
`apps/bot`'s APPLY_HANDOFF state, resolves the token via `packages/db`, and
renders the matching Birth/Death certificate form.

## 1. Env setup

```bash
cp .env.example .env.local
```

`DATABASE_URL` must point at the same Postgres database `apps/bot` uses
(see `docker-compose.yml` at the repo root).

## 2. Run it

From the repo root:

```bash
pnpm install
pnpm dev:web
```

Visit `http://localhost:3000` directly only shows a placeholder notice —
this app is meant to be reached via the link WhatsApp sends.
