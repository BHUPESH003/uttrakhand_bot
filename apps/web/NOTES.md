# apps/web build notes

Session record of building `apps/web` — the public application form the
WhatsApp bot's CTA button lands on — and a bug found in `packages/db` along
the way. Written as a handoff/reference doc, not a how-to (see `README.md`
for setup).

> Note: this repo runs multiple concurrent Claude Code sessions. Some files
> referenced below (`theme.ts`, `next.config.ts`, the API route, `.env.example`)
> have since been extended by later work (a shared `packages/theme`, an
> `apps/admin`, a bot-notify webhook, ngrok dev support) that isn't covered
> here — this doc reflects what was built and verified in this session.

## What was built

- **`/apply` route** (`src/app/apply/page.tsx`) — server component. Reads
  `service` (`birth|death`), `token`, `lang` (`en|hi`), `n` (name) from the
  query string. Resolves `token` via `packages/db`'s `resolveToken`; if
  missing or past `expiresAt`, renders a bilingual "link expired/invalid"
  screen and stops. Otherwise renders the matching form, prefilled from `n`.

- **`ApplyForm.tsx`** — client component. Two explicit forms
  (`BirthApplyForm` / `DeathApplyForm`), not one generic field-renderer over
  a union type — birth and death have fully disjoint field sets, so a shared
  abstraction would have fought TypeScript for no real reuse. Both share a
  `submitApplication()` helper, `Field`/`SuccessScreen` components, and
  Tailwind class constants. Validation via `react-hook-form` +
  `@hookform/resolvers/zod`, controlled entirely through RHF (no native form
  auto-submit).
  - Birth fields: applicant name, child's name, DOB, place of birth,
    father's name, mother's name, address.
  - Death fields: applicant name, deceased's name, date/place of death,
    cause of death, informant's name/relation, address.

- **`POST /api/apply`** (`src/app/api/apply/route.ts`) — re-resolves the
  token server-side (never trusts a client-sent `service` or `applicantName`
  — those come from the resolved token / validated form data only), picks
  the zod schema by `tokenRow.service`, calls `createApplication` then
  `attachApplicationToToken`, returns `{ referenceNumber }`.

- **`src/theme.ts`** — originally the single source of truth for colors
  (navy/green placeholders), font stack, and the emblem asset path, read by
  both `tailwind.config.ts` (via Tailwind v4's `@config` directive in
  `globals.css`) and components directly. (Since superseded by a shared
  `packages/theme` — see the note above.)

- **`src/copy.ts`** — bilingual (en/hi) UI copy, same keyed-record pattern as
  `apps/bot/src/flow/copy.ts`.

- **`src/schema.ts`** — `birthFormSchema` / `deathFormSchema` (zod), shared
  between the client form and the API route's server-side validation.

- **`src/token.ts`** — `resolveValidToken()`: the one "missing or expired"
  check, used by both the page and the API route.

- Root `package.json`: added `dev:web` / `build:web` / `start:web`. Web runs
  on port **3001** (`next dev -p 3001` / `next start -p 3001`) since
  `apps/bot` already owns 3000.

## Bug found in packages/db (out of this session's original scope)

`generateReferenceNumber()` in `packages/db/src/applications.ts` builds the
next reference number as `count(rows of this type) + 1`. `packages/db/prisma/seed.ts`
originally numbered its 3 seed rows with **one global counter across both
types**: `UK-BIRTH-000001`, `UK-DEATH-000002`, `UK-BIRTH-000003`.

Effect: immediately after seeding, `BIRTH` count = 2 → next number
`UK-BIRTH-000003` (already taken by the seed), and `DEATH` count = 1 → next
number `UK-DEATH-000002` (already taken). **Every real submission failed
with a Prisma `P2002` unique-constraint error on the very first try** — not
a rare concurrency race (which is what the code's own `ponytail:` comment
warns about), but a deterministic collision from seed data using a
different numbering scheme than the generator assumes.

Since `packages/db` belongs to another concurrently-active session, this
was surfaced to the user rather than patched silently. With explicit
approval, the fix applied:

1. Renumbered `prisma/seed.ts` per type: `UK-BIRTH-000001`, `UK-DEATH-000001`,
   `UK-BIRTH-000002` (and fixed the one `certificatePdfPath` that referenced
   the old number).
2. Deleted the 3 stale-numbered rows from the shared local Postgres and
   re-ran `pnpm --filter db seed` to reinsert them under the corrected
   numbers (same 3 people/records, just consistent numbering).

Recorded as a `danger` entry in matha, then retired once verified fixed.

## Verification performed

- `pnpm --filter web typecheck` and `pnpm --filter web build` — both clean.
  (Hit and fixed one incidental issue: this repo's `typescript@7.0.2`
  removed the `baseUrl` compiler option — `tsconfig.json` uses bare `paths`
  now.)
- Live end-to-end smoke test against the real local Postgres
  (`docker-compose.yml` at repo root):
  1. Minted a real `HandoffToken` via `packages/db`'s `createToken`.
  2. `GET /apply?service=birth&token=...&lang=en&n=...` → 200, correct form,
     applicant name prefilled (confirmed visually via a headless-Chrome
     screenshot, since curl/raw HTML doesn't show RHF's client-hydrated
     `defaultValues`).
  3. `GET /apply` with an invalid/unknown token → 200, bilingual
     "link expired or invalid" screen, no form.
  4. `POST /api/apply` for both `BIRTH` and `DEATH` tokens → 200, real
     reference numbers returned (`UK-BIRTH-000003`, `UK-DEATH-000002` at
     the time — numbers will differ per DB state).
  5. Confirmed via `packages/db`'s `getApplicationByReference` (exactly what
     `apps/bot`'s TRACK_RESULT state calls) that both applications are
     found, with `mobileNumber` matching the token's, and that
     `HandoffToken.applicationId` got attached on both tokens.
  6. Cleaned up the smoke-test rows/tokens afterward so the shared DB was
     left with only the corrected seed data.

## Run commands

```bash
docker compose up -d                        # local Postgres (repo root)
cp apps/web/.env.example apps/web/.env.local
pnpm install
pnpm dev:bot     # :3000
pnpm dev:web     # :3001
```

Set `WEB_FORM_URL=http://localhost:3001` in `apps/bot/.env` so the bot's CTA
button points at the local web app.

## Full-loop test

1. WhatsApp → Menu → **Apply for Certificate** → Birth or Death → tap
   **Fill Application Form**.
2. Lands on `/apply?service=...&token=...&lang=...&n=...` — correct field
   set, name prefilled, correct language.
3. Submit → success screen with a reference number (e.g. `UK-BIRTH-000003`).
4. Back in WhatsApp → Menu → **Track Status** → enter that reference number
   → bot finds it via `getApplicationByReference`, replies with status
   "Submitted".
