# Conversation Engine, Flow, and Database — Build Notes

This documents two build phases carried out for the Uttarakhand WhatsApp
bot: the declarative conversation engine/menu flow, and the shared
database/types packages that later replaced the in-memory session store.

> **Scope note:** this covers what was built in those two phases only. The
> repo has since grown further (`apps/web`, `apps/admin`, document sending,
> an internal notify-approved endpoint, additional copy keys, etc.) — that
> work happened outside this record and isn't described here.

## Phase 1 recap (pre-existing)

`apps/bot` started as a Fastify webhook + a generic WhatsApp Cloud API
client (`whatsapp/client.ts`) that echoed back whatever the user sent. See
`CLAUDE.md` for the full stack/layout conventions.

## Phase 2 — Conversation engine + Uttarakhand menu flow

Goal: a **declarative** flow — the conversation is data, executed by a
small generic engine — so adding a menu item or reordering steps means
editing one file (`flow/definition.ts`) without touching the engine.

### Session store

`session/store.ts` — `Session { userId, currentStateKey, data, lastInboundAt, updatedAt }`
behind a `SessionStore` interface (`getSession` / `saveSession` /
`resetSession`), backed by an in-memory `Map` at this stage.

### Flow types (`flow/types.ts`)

- `OutgoingAction` — a discriminated union (`sendText` / `sendImage` /
  `sendReplyButtons` / `sendList` / `sendCtaUrl`) describing *what* to send,
  not a direct client call — keeps states testable without a live client.
- `FlowContext` — exposes `session`, the normalized `IncomingMessage`, and
  a `t(key, vars?)` copy-resolution helper.
- `FlowState` — `{ key, onEnter(ctx), handleInput(ctx) }`. `handleInput`
  returns the next state key, or `null` to signal "input not understood."

### Bilingual copy (`flow/copy.ts`)

Every user-facing string lives in one `{ en: {...}, hi: {...} }` map, keyed
identically across languages. `resolveCopy(lang, key, vars)` substitutes
`{{placeholder}}` tokens. A `CopyKey` type (`keyof typeof en`) gives
states compile-time typo-checking on `ctx.t(...)` calls. Language defaults
to English until `LANGUAGE` state sets `session.data.lang`.

### The flow itself (`flow/definition.ts`)

States, as data, in `flowStates: Record<string, FlowState>`:

| State | Purpose |
|---|---|
| `WELCOME` | Banner image + consent text, buttons `Proceed` / `Opt Out` |
| `LANGUAGE` | Buttons `English` / `हिंदी`, stores `session.data.lang` |
| `MAIN_MENU` | List: Apply for Certificate / Track Status / Download Certificate / Help |
| `APPLY_CHOOSE` | Buttons `Birth Certificate` / `Death Certificate` |
| `APPLY_HANDOFF` | Mints a token, builds the web-form URL, sends a CTA-url message + a separate Back-to-Menu button |
| `TRACK_ASK` | Prompts for a reference/token number (free text) |
| `TRACK_RESULT` | Reports status (Phase 2: a TODO placeholder; replaced with a real DB lookup in Phase 3) |
| `DOWNLOAD` | TODO placeholder ("no certificates ready yet") |
| `HELP` | Short bilingual help text |
| `OPTED_OUT` | Goodbye message; any later message restarts at `WELCOME` |

ENTRY behaviour (mirroring a `CheckDevoteeAction`-style pattern from a
reference bot): the first inbound message from an unknown number registers
that number, stores the WhatsApp profile name in `session.data.name`, and
routes straight to `WELCOME` — no login/account gate.

`APPLY_HANDOFF` mirrors a `BaseBookingLinkAction`-style pattern: generate a
token, build
`` `${WEB_FORM_URL}/apply?service=${slug}&token=${token}&lang=${lang}&n=${encodeURIComponent(name)}` ``,
send it as a `cta_url` interactive message.

### Engine (`flow/engine.ts`)

Generic runner, no menu-specific knowledge:

1. Load session (no session → ENTRY → `WELCOME`).
2. Set `lastInboundAt`.
3. **GLOBAL rule:** reply id `back_to_menu` always routes to `MAIN_MENU`,
   regardless of current state — checked before calling `handleInput`.
4. Otherwise run the current state's `handleInput` to get the next key.
5. **GLOBAL rule:** if `handleInput` returns `null` (unrecognized input),
   send the localized `fallback_body` text, then re-enter the *same*
   state (re-showing its menu).
6. Run the next state's `onEnter`, translate each `OutgoingAction` into a
   real `WhatsAppClient` call.
7. Save the session.

Both global rules reference only *constants* exported by `definition.ts`
(`MAIN_MENU_STATE_KEY`, `ENTRY_STATE_KEY`) — the engine file itself never
hardcodes a menu shape.

### WhatsApp payload shapes

Verified against Meta Cloud API docs in `whatsapp/client.ts`:
- Reply buttons: `interactive.type = "button"`, up to 3 buttons, each
  `{ type: "reply", reply: { id, title } }`.
- List: `interactive.type = "list"`, `action.button` + `action.sections[].rows[]`
  (`{ id, title, description? }`), max 10 rows total across all sections.
- CTA URL: `interactive.type = "cta_url"`, `action.name = "cta_url"`,
  `action.parameters = { display_text, url }`.

Button/row `id`s double as the routing keys the engine reads back from the
webhook (`IncomingMessage.replyId`).

### Wiring

`routes/webhook.ts`'s `POST /webhook` handler replaced the echo logic with
`handleIncomingMessage(message)`; still returns 200 immediately and
processes messages without blocking the response, per `CLAUDE.md`'s
webhook conventions.

### Self-check

`flow/engine.test.ts` — assert-based (no framework), run via
`pnpm --filter bot test`. Exercises the full state graph — WELCOME →
LANGUAGE → MAIN_MENU → APPLY_CHOOSE → APPLY_HANDOFF → back-to-menu →
TRACK_ASK → TRACK_RESULT → fallback → OPTED_OUT → restart — against a
recording fake of `WhatsAppClient` (no real HTTP calls to Meta).

### Bilingual test script (as of Phase 2)

**English:**
1. Send any message → banner + consent, buttons **Proceed** / **Opt Out**.
2. **Proceed** → buttons **English** / **हिंदी**.
3. **English** → menu list (Apply / Track / Download / Help).
4. **Apply for Certificate** → **Birth Certificate** → CTA button "Fill
   Application Form" linking to the web form, + separate **Back to Main
   Menu** button.
5. **Track Status** → type a reference → placeholder "coming soon" message.
6. **Download Certificate** / **Help** → placeholder text + Back to Menu.
7. Gibberish text at any menu → fallback message, menu re-shown.
8. **Opt Out** from WELCOME → goodbye; any later message restarts at WELCOME.

**हिंदी:** same sequence — **Proceed**/**Opt Out** on WELCOME, then पसंदीदा
भाषा में **हिंदी** चुनने के बाद हर स्क्रीन (मेनू, आवेदन, ट्रैक स्टेटस,
सहायता, फ़ॉलबैक, विदाई संदेश) हिंदी में दिखती है।

## Phase 3 — Shared DB/types packages + DB-backed sessions

Goal: replace the in-memory session Map with Postgres, add shared
`packages/db` and `packages/types` workspace packages, and wire real data
into `TRACK_RESULT` and `APPLY_HANDOFF`.

### `packages/types`

Zero-dependency shared types, re-exported so every app imports from one
place: `Service` (`"BIRTH" | "DEATH"`), `ApplicationStatus`,
`MessageDirection`, `Lang`, and a `CertificateApplication` shape mirroring
the DB model.

### `packages/db` — Prisma + Postgres

Modeled on a reference WhatsApp bot's entities (`MessageHistory`,
`WhatsAppSessionDetail`, `MetaAuditDetail` — found in the Java backend at
`PMLI/backend/pelocal-whatsapp-bot-service-backend` and
`pelocal-meta-service-backend`; a `TempleBooking`/`CheckDevoteeAction`/
`BaseBookingLinkAction` reference bot mentioned for the flow-shape wasn't
found on this machine, so those pieces used the same judgment as Phase 2).

Schema (`prisma/schema.prisma`):
- **`CertificateApplication`** — `id` (cuid), `referenceNumber` (unique,
  e.g. `UK-BIRTH-000123`), `type` (`CertificateType` enum), `status`
  (`ApplicationStatus` enum, default `SUBMITTED`), `applicantName`,
  `mobileNumber` (nullable), `language`, `formData` (Json), `certificatePdfPath`
  (nullable), `rejectionReason` (nullable), `reviewedAt` (nullable),
  timestamps.
- **`HandoffToken`** — `token` (`@id`), `mobileNumber`, `service`, `language`,
  `applicantName`, `applicationId` (nullable, set once the form is
  submitted), `createdAt`, `expiresAt`.
- **`Session`** — `userId` (phone, `@id`), `currentStateKey`, `data` (Json),
  `lastInboundAt`, `updatedAt`.
- **`MessageLog`** — `id`, `mobileNumber`, `direction` (`INCOMING`/`OUTGOING`),
  `type`, `status`, `payload` (Json), `waMessageId` (nullable), `createdAt`.

Helpers (`src/*.ts`): `createApplication`, `getApplicationByReference`,
`getLatestApplicationForNumber`, `updateApplicationStatus`,
`generateReferenceNumber` (count-per-type, e.g. `UK-BIRTH-000123` —
`ponytail:` flagged as a race condition under concurrent creates, fine for
demo traffic); `createToken` / `resolveToken` / `attachApplicationToToken`;
`logMessage`; `isWithinWindow(mobileNumber)` (mirrors the reference bot's
`WhatsAppSessionDetail` 24h window — checks `Session.lastInboundAt` first,
falls back to the latest `INCOMING` `MessageLog` row).

`docker-compose.yml` at the repo root runs local Postgres 16. `prisma/seed.ts`
seeds sample applications with varied statuses so Track Status has
something to find (upsert-based, safe to re-run).

**Note on Prisma version:** deliberately pinned to the stable 6.x line
rather than the newly-released 7.x. Prisma 7 requires a new
`prisma.config.ts` + a custom generated-client output path, and its `init`
command auto-installs unrelated `.claude/skills` scaffolding into the
package — unwanted complexity for this project. Revisit if a future
upgrade is warranted.

### `apps/bot` wiring

- `session/store.ts` — `Session.lastInboundAt`/`updatedAt` changed from
  epoch numbers to `Date` (matching Prisma's `DateTime`). `SessionStore`
  methods became `Promise`-returning. Added `DbSessionStore` (now the
  exported `sessionStore` singleton); `InMemorySessionStore` kept as an
  exported class for tests/reference.
- `flow/engine.ts` — every inbound message is logged to `MessageLog`
  before any state logic runs; every outbound message (including the
  fallback message) is logged via a single `executeAction` funnel so
  nothing skips logging. Idle reset: if `now - lastInboundAt` exceeds
  `SESSION_IDLE_MINUTES` (env, default 30), the session restarts fresh at
  `WELCOME` exactly like a brand-new number.
- `flow/types.ts` — `FlowState.onEnter` / `handleInput` return types
  loosened to `Promise<T> | T`, so only the states that actually need a DB
  call (`APPLY_HANDOFF`, `TRACK_RESULT`) became `async`; everything else
  stayed synchronous.
- `flow/definition.ts` — `APPLY_HANDOFF` now calls `createToken(...)`
  (24h TTL) before building the CTA URL. `TRACK_RESULT` now normalizes the
  typed-in reference (`trim().toUpperCase()`) and calls
  `getApplicationByReference`, reporting a localized status label (with
  rejection reason appended for `REJECTED`) or a graceful not-found message.
- `config.ts` — added `DATABASE_URL` (validated here too, so the bot fails
  fast on boot rather than on the first DB call) and `SESSION_IDLE_MINUTES`.
- `packages/db` and `packages/types` referenced via `"workspace:*"`.

### Reproducing locally

```bash
# from repo root
docker compose up -d                                  # start Postgres
pnpm --filter db migrate                               # apply migrations
pnpm --filter db generate                               # regenerate Prisma client if needed
pnpm --filter db seed                                    # seed sample applications
pnpm --filter db build && pnpm --filter types build      # packages need dist/ before apps/bot can import them
pnpm --filter bot dev                                     # or: build + start
```

Needs `packages/db/.env` and `apps/bot/.env` with `DATABASE_URL` (see the
corresponding `.env.example` files).

### Verification performed

- `pnpm -r typecheck` and `pnpm -r build` clean across all packages.
- Booted the built server (`node dist/index.js`) against live Postgres —
  health check and the Meta webhook-verify handshake both responded
  correctly.
- `pnpm --filter bot test` rewritten as a live integration check against
  real Postgres (the point of this phase), confirming:
  - Track Status found seeded reference `UK-BIRTH-000001`, correctly
    reporting its live status, and gracefully reported "not found" for a
    bogus reference.
  - `APPLY_HANDOFF` persisted a real `HandoffToken` row (verified via
    `resolveToken`).
  - Idle reset: backdating a session's `lastInboundAt` past 30 minutes
    correctly restarted it at `WELCOME` on the next message.
  - `message_logs` populated for both `INCOMING` and `OUTGOING` across all
    message kinds sent during the run.

### Environment quirk encountered

Mid-build, this environment silently dropped a couple of freshly-written
files without any error (`packages/db/package.json` once, its
`tsconfig.json` once) — each was caught via a follow-up existence check
and rewritten. Worth knowing about if a file ever seems to vanish right
after a successful write in this workspace.
