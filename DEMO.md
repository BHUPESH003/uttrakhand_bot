# Uttarakhand e-Seva — Admin Dashboard & Demo Guide

Session notes covering the `apps/admin` build, the WhatsApp↔web↔admin
integration, the local demo setup (ngrok), and every bug found and fixed
while getting it working end to end.

## What's in the system

Three apps, one shared Postgres, two shared packages:

```
apps/bot    (Fastify, :3000)  WhatsApp Cloud API webhook + conversation flow
apps/web    (Next.js, :3001)  the "fill your application" form, reached via a WhatsApp link
apps/admin  (Next.js, :3002)  approval dashboard for government staff

packages/db     Prisma client + typed query functions, shared by all three
packages/theme  colors/fonts/logo — single source of truth for web + admin
packages/types  shared string-literal unions (Service, ApplicationStatus, Lang)
```

### apps/admin (built this session)

- **Auth**: demo-only — a single shared password (`ADMIN_PASSWORD`) compared
  to a plaintext cookie value (`src/lib/auth.ts`). No hashing, no per-user
  accounts, no CSRF token. `src/proxy.ts` gates every route except `/login`,
  `/certificates/*` (WhatsApp's servers must fetch PDFs without a cookie),
  and `logo_uk.jpg` (should render on the login page too).
- **Dashboard** (`/`): table of applications, filterable by status/type via
  a plain GET form (no client JS needed).
- **Detail view** (`/applications/[id]`): applicant info, all form data,
  read-only WhatsApp conversation history (from `MessageLog`), and
  Approve/Reject actions when the application is `SUBMITTED`/`UNDER_REVIEW`.
- **Approve**: generates a certificate PDF (`src/lib/pdf.ts`, via `pdfkit`),
  saves it under `public/certificates/`, sets `status=APPROVED` +
  `certificatePdfPath`, then calls the bot to notify the applicant.
- **Reject**: requires a reason, sets `status=REJECTED` + `rejectionReason`.

### Bot ↔ admin integration

Two internal endpoints on the bot, both gated by a shared secret
(`INTERNAL_API_SECRET`, sent as the `x-internal-secret` header):

- `POST /internal/notify-submitted { applicationId }` — called by
  `apps/web`'s `/api/apply` route right after an application is created.
  Sends a free-form WhatsApp confirmation with the reference number.
- `POST /internal/notify-approved { applicationId }` — called by admin
  after Approve. Sends "your certificate is ready" + the PDF document.

Both check `isWithinWindow(mobileNumber)` first (WhatsApp only allows
free-form messages within 24h of the user's last inbound message) and
return `{status: "outside_window"}` instead of failing if it's been too
long — the caller (web form / admin UI) always still shows its own success
state regardless, since the notification is best-effort.

## Environment variables

| File | Vars | Notes |
|---|---|---|
| `apps/bot/.env` | `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `VERIFY_TOKEN` | Real values from Meta App Dashboard > WhatsApp > API Setup. `PHONE_NUMBER_ID` is the numeric **ID** Meta assigns, not the phone number itself. |
| | `WEB_FORM_URL` | Public URL of `apps/web` (ngrok tunnel for the demo). |
| | `BANNER_IMAGE_URL` | Public **JPEG/PNG** (WhatsApp rejects SVG for image messages). |
| | `INTERNAL_API_SECRET` | Shared secret — must match `apps/web` and `apps/admin`'s copies exactly. |
| `apps/web/.env.local` | `DATABASE_URL`, `BOT_INTERNAL_URL`, `INTERNAL_API_SECRET` | |
| `apps/admin/.env.local` | `DATABASE_URL`, `ADMIN_PASSWORD`, `INTERNAL_API_SECRET`, `BOT_INTERNAL_URL`, `ADMIN_PUBLIC_URL` | `ADMIN_PUBLIC_URL` must be a public URL too — it's baked into `certificatePdfPath` so WhatsApp can fetch the PDF. |

`BOT_INTERNAL_URL` stays `http://localhost:3000` even in the tunneled demo —
admin calls the bot server-to-server on the same machine, no tunnel needed
for that hop.

## Running everything

```bash
docker compose up -d                 # Postgres
pnpm --filter db migrate:deploy
pnpm --filter db seed                # optional sample data

pnpm dev:all                         # all three apps in parallel (pnpm --parallel)
```

This section is local dev only. For a real deployment (web on Vercel,
bot + admin on a VM behind nginx, TLS via Let's Encrypt), see
[`deploy/README.md`](deploy/README.md) — it has the full runbook and the
scripts that automate it.

### Exposing it over WhatsApp (ngrok)

```bash
ngrok start --all --config ~/.config/ngrok/ngrok.yml --config ./ngrok.yml
# (a 3-tunnel ngrok.yml for ports 3000/3001/3002 — see below)
curl -s http://127.0.0.1:4040/api/tunnels   # get the current public URLs
```

```yaml
# ngrok.yml
version: "3"
tunnels:
  bot:   { proto: http, addr: 3000 }
  web:   { proto: http, addr: 3001 }
  admin: { proto: http, addr: 3002 }
```

Free-tier ngrok URLs rotate every restart — re-check the tunnel URLs and
update `WEB_FORM_URL` (bot) / `ADMIN_PUBLIC_URL` (admin) each time, then
restart the bot (it only loads `.env` once at boot; the two Next apps
auto-reload `.env.local`).

### Registering the webhook callback URL (via curl, not the dashboard)

```bash
# 1. Point the app's webhook config at your tunnel + verify token
curl -X POST "https://graph.facebook.com/v21.0/{APP_ID}/subscriptions" \
  -d "object=whatsapp_business_account" \
  -d "callback_url=https://<bot-tunnel>/webhook" \
  -d "verify_token={VERIFY_TOKEN}" \
  -d "fields=messages" \
  -d "access_token={APP_ID}|{APP_SECRET}"

# 2. Subscribe your WhatsApp Business Account to this app
curl -X POST "https://graph.facebook.com/v21.0/{WABA_ID}/subscribed_apps" \
  -d "access_token={WHATSAPP_TOKEN}"
```

The callback URL **must** be `/webhook`, not the bare tunnel root — root
only returns `{"status":"ok"}` and can't answer Meta's verification
challenge or accept event POSTs.

## End-to-end demo script

1. **User messages the bot on WhatsApp** → Proceed → pick a language → Main
   Menu → "Apply for Certificate" → Birth or Death → bot sends a CTA button
   linking to the web form.
2. **User fills the web form** → submits → application created as
   `SUBMITTED` → **bot sends a WhatsApp confirmation with the reference
   number** (via `/internal/notify-submitted`).
3. **Admin logs in**, sees the new application, opens it — applicant info,
   form data, conversation history.
4. **Admin clicks Approve** → PDF generated and saved → bot sends "your
   certificate is ready" + the PDF document on WhatsApp.
5. **User taps "Download Certificate"** in the bot menu → now sends the
   real PDF (previously always said "nothing ready" — see below).
6. **User taps "Track Status"** → reports `Approved`.

If Approve happens >24h after the user's last message, admin shows
"outside the 24h window — a template message is required" instead of
silently failing — approve promptly in a demo to stay inside the window.

## Bugs found and fixed this session

- **CTA button text over WhatsApp's 20-char limit** — `apply_handoff_button`
  copy was 21 characters (`"Fill Application Form"`); WhatsApp's `cta_url`
  `display_text` caps at 20. Confirmed via the raw Graph API error, shortened
  to `"Fill Application"`.
- **Web form always showed "link expired"** — not actually about expiry.
  Next.js dev blocks cross-origin JS/HMR by default; opened through the
  ngrok tunnel, the page rendered but never hydrated, so the form's submit
  handler never attached and the browser fell back to a native `GET` to the
  same URL, wiping `token`/`service` from the query string. Fixed with
  `allowedDevOrigins: ["*.ngrok-free.app"]` in both `apps/web` and
  `apps/admin`'s `next.config.ts`.
- **pdfkit crashed the whole admin detail page under Turbopack** —
  `fontkit` (pdfkit's font-parsing dependency) references an `@swc/helpers`
  export that doesn't survive Turbopack's RSC bundling. Fixed with
  `serverExternalPackages: ["pdfkit"]`.
- **Admin's `proxy.ts` blocked its own logo image** — an unauthenticated
  request for `/logo_uk.jpg` got redirected to `/login`, so the header logo
  never rendered (and wouldn't have shown on the login page at all). Added
  it to the proxy's exclusion list.
- **Hydration mismatch console error** — not our bug: the ColorZilla browser
  extension injects `cz-shortcut-listen` onto `<body>` before React
  hydrates. Added `suppressHydrationWarning` to `<body>` in both apps (the
  documented fix for exactly this class of issue).
- **Certificate PDF: Hindi text rendered as garbage** — pdfkit's built-in
  Helvetica has no Devanagari glyphs. Bundled the same `Noto Sans
  Devanagari` font the web app already uses (copied from the system into
  `apps/admin/assets/fonts/`, not referenced by OS path) and switched fonts
  for that line only.
- **Certificate PDF: spurious blank second page** — footer text sat inside
  pdfkit's default bottom margin, which silently triggers an auto
  page-break instead of clipping. Fixed by zeroing `doc.page.margins.bottom`
  right before drawing the footer.
- **Certificate PDF: logo overlapped the header text** — text x-position
  was a guessed fixed offset assuming a roughly-square logo; the real logo
  is ~1.8:1. Now computed from the logo's known aspect ratio.
- **Stale `certificatePdfPath` values** — several already-approved seed/test
  applications pointed at placeholder URLs (`/certs/...`, `example.com`)
  instead of real generated files. Regenerated all existing certificates in
  place and corrected the DB paths.
- **"Download Certificate" always said "(Coming soon)"** — not a bug, just
  stale copy from before the feature existed. The logic was already correct
  (sends the real PDF once the user's latest application is `APPROVED`);
  reworded the "not ready yet" message to explain why instead of implying
  the feature doesn't exist.
- **No way back to the dashboard from an application's detail page** —
  added a "← Back to Applications" link, and made the header logo/brand a
  link to home in both apps.
- **No footer** — added one to both apps' layouts (demo disclaimer).

## Known limitations (demo-only, by design)

- Admin auth is a single shared password in a plaintext cookie — fine for a
  demo, not real auth. See the comments in `src/lib/auth.ts`.
- ngrok free-tier URLs rotate on every restart; `WEB_FORM_URL` /
  `ADMIN_PUBLIC_URL` / the registered webhook callback all need updating
  each time unless you're on a paid ngrok plan with a static domain.
- The certificate PDF's footer is only guaranteed on the last page if
  content ever overflows past one page (unlikely given the current form
  field counts, but not actively handled per-page).
- `generateReferenceNumber` uses a per-type `COUNT` query, not a DB
  sequence — fine for demo traffic, would race under real concurrent load
  (already flagged with a `ponytail:` comment in `packages/db`).
