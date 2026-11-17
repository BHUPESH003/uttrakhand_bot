# Commerce demo plan

Status: **plan only, nothing implemented yet.** Waiting on go-ahead and on
the open questions in section 5.

Any Meta payload shape named below is an *assumption to verify* against the
official docs before code depends on it. Where the docs differ, the code
follows the docs and the difference gets reported.

## 0. What the repo looks like today (relevant parts)

- `apps/bot/src/server.ts` registers two route modules: `routes/webhook.ts`
  (Meta GET verify + POST messages) and `routes/internal.ts` (admin → bot
  notifications, gated by `x-internal-secret` and `isWithinWindow`).
- `whatsapp/client.ts` is the one typed Graph API client. Every send goes
  through the `protected post()` method. Tests override that method to skip
  the network, and length/count checks are done with `assertMaxLength`.
- `flow/types.ts` defines `OutgoingAction` (a description of a send) and
  `FlowState { key, onEnter, handleInput }`. `flow/actions.ts` maps each
  action kind to one client call and then calls `logMessage`.
- `flow/engine.ts` is generic. It loads the session, applies the global rules
  (back-to-menu, track, "hi" restart, "language"), and has one special case:
  `AI_CHAT`, which goes through `flow/aiChat.ts`.
- `flow/definition.ts` holds every state as data. `MAIN_MENU` sends 3 reply
  buttons (Apply/Track/Download, already at WhatsApp's 3-button cap) plus a
  list with 3 rows (Help, Chat, Change Language). The list has room for up to
  10 rows.
- `flow/copy.ts` has `en`, plus `hi` typed as `Record<keyof typeof en, string>`.
  Any key added to `en` that is missing from `hi` is a compile error.
- `session/store.ts` defines the `SessionStore` interface plus
  `InMemorySessionStore` (no TTL) and `DbSessionStore`. The live one is the
  DB store, backed by the Prisma `Session` table, with `data` as a JSON bag.
- `packages/db` has `logMessage` / `listMessagesForNumber` (the `MessageLog`
  table) and `isWithinWindow` (the 24h window, read from
  `Session.lastInboundAt` with `MessageLog` as fallback).
- `config.ts` validates env with zod and throws at import time. The phone
  number id env var is **`PHONE_NUMBER_ID`**, not `WA_PHONE_NUMBER_ID`.
- Tests: `flow/engine.test.ts` is a plain `node:assert` script run by
  `tsx`. It needs a live Postgres and fakes only `WhatsAppClient.post`.

## 1. Where each new piece goes

| Piece | Location | Notes |
|---|---|---|
| Demo safety env vars | `apps/bot/src/config.ts` + `.env.example` | `DEMO_SEND_ENABLED` (bool, default false), `DEMO_ALLOWED_RECIPIENTS` (CSV → `Set`), `DEMO_DATASET` (`neutral`\|`voucher`, default `neutral`), `PROTECTED_PHONE_NUMBER_IDS` (CSV). Uses a zod `superRefine` so `voucher` with `PHONE_NUMBER_ID ∈ PROTECTED_PHONE_NUMBER_IDS` throws at startup, using the existing error format. |
| Flow endpoint secrets | `config.ts` | `FLOW_PRIVATE_KEY` (PEM) and optional `FLOW_PRIVATE_KEY_PASSPHRASE`, `META_APP_SECRET` (for `X-Hub-Signature-256`). These are **optional** so the certificate bot still boots without them; the Flow route is registered only when they are set. |
| New client methods | `whatsapp/client.ts` | `sendFlow(to, { flowId, flowToken, ctaText, body, header?, screen?, data? })` posts `interactive.type = "flow"` and returns the wamid like `sendAudio` does. Length checks follow the existing `assertMaxLength` pattern. Add catalog/product methods only if the scope in Q1 needs them. |
| New action kind | `flow/types.ts`, `flow/actions.ts` | `{ kind: "sendFlow", ... }` added to `OutgoingAction`, plus one `case` in `executeAction`. States still never touch the client directly. |
| Inbound Flow completion | `whatsapp/types.ts`, `whatsapp/parse.ts` | Today `interactive.type = "nfm_reply"` falls through to `type: "other"`. Add `type: "flow_reply"` with `flowResponse` (the parsed `response_json`) to `IncomingMessage`. |
| Flow data-exchange endpoint | `routes/flowEndpoint.ts`, registered in `server.ts` | `POST /flow-endpoint`: check the signature, decrypt, dispatch on `action` (`ping`, `INIT`, `data_exchange`, `BACK`), encrypt, and reply. The logic for "what screen comes next" goes in `commerce/flowHandler.ts`, so the route stays transport-only, the same way `webhook.ts` hands off to the engine. |
| Flow crypto | `whatsapp/flowCrypto.ts` | `decryptRequest` / `encryptResponse` using `node:crypto` (RSA-OAEP-SHA256 to unwrap the AES key, AES-128-GCM with the flipped IV for the response). These algorithms are from memory, so verify them against the docs. **No new dependency.** |
| Demo data (the one fake-data module) | `apps/bot/src/commerce/data.ts` | Catalog, prices, order/status fixtures for both `neutral` and `voucher`, selected via `config.DEMO_DATASET`. Nothing else in the codebase hardcodes business data. |
| Commerce session store | `apps/bot/src/commerce/store.ts` | See section 3. |
| Send gate | `apps/bot/src/commerce/gate.ts` (`canSendDemo(to)`) | See section 2. |
| Flow JSON | `apps/bot/flows/commerce.json` | The WhatsApp Flow definition, kept in git. |
| Scripts | `apps/bot/scripts/` | `gen-flow-keys.ts` (generates an RSA keypair with `node:crypto` and prints the public key), `upload-flow-public-key.ts` (`POST /{PHONE_NUMBER_ID}/whatsapp_business_encryption`), and optionally `publish-flow.ts` (create/update/publish the Flow JSON). These make their own Graph calls because they're one-off admin tools rather than conversation sends. If you'd rather the client also own these, they become client methods (see Q6). |
| Tests | `apps/bot/src/commerce/commerce.test.ts` (no DB needed) + new cases in `flow/engine.test.ts` | The commerce test covers a crypto round trip, the flowHandler screen transitions, gate allow/deny, store TTL expiry, and the config `voucher` + protected-id throw. Engine test: the menu row appears or not depending on the gate, and an `nfm_reply` reaches the right state. `package.json` `test` runs both files. |
| Copy | `flow/copy.ts` | New `commerce_*` keys in both `en` and `hi`. The compiler already enforces parity. |

## 2. Plugging into the declarative flow

- **Menu entry:** add one row, `{ id: "menu_shop", title: ctx.t("menu_shop") }`,
  to MAIN_MENU's existing "More Options" list (3 → 4 rows, under the cap of 10).
  The 3 reply buttons stay as they are. MAIN_MENU `handleInput` gets
  `case "menu_shop": return COMMERCE_START_STATE_KEY`.
- **Gated row:** the row is added only when `canSendDemo(ctx.session.userId)`
  is true. A user who isn't on the allowlist never sees it, and
  `handleInput` checks the gate again in case of a stale tap.
- **New states** (all in `definition.ts`, under `COMMERCE_*` keys):
  - `COMMERCE_START`: an intro text, then `sendFlow` (opens the catalog/cart
    Flow) and the `backToMenuButton`.
  - `COMMERCE_CONFIRM`: entered when an `nfm_reply` comes back. It shows the
    order summary from the store and a fake "order placed / ref ABC123"
    message, with Track Order and Back to Menu.
  - `COMMERCE_TRACK` (optional): fake status lookup from `commerce/data.ts`.
- **Engine changes:** ideally none. The global rules (back-to-menu, "hi",
  "language") already apply to the new states. The `nfm_reply` is handled by
  `COMMERCE_START.handleInput` reading `message.type === "flow_reply"`. One
  edge case: the user taps "hi" mid-Flow and then submits the Flow later. The
  engine is then in another state, so the reply hits the fallback. That's
  acceptable for a demo, or we add a one-line global rule like `TRACK_STATUS_ID`.
- **Send gate enforcement:** the menu row hides the entry point. As a hard
  stop, `executeAction` gets one guard: an action with `demo: true`
  (set only by commerce states) is dropped and logged as `blocked` when
  `canSendDemo(to)` is false. Certificate states never set that flag, so
  their behaviour can't change. The Flow endpoint also refuses any
  `flow_token` whose user fails the gate.
- **Certificate flow safety:** the only edits to existing states are one list
  row and one `case`. `engine.test.ts` keeps passing unchanged, plus the new
  cases.

## 3. Session state

- The engine's conversation session (`currentStateKey`, `lang`, etc.) stays
  in the existing `DbSessionStore`. That isn't new state, and changing it would
  affect the certificate flow.
- Commerce state (cart, chosen items, the fake order) goes in a new
  **in-memory store behind an interface, with a TTL**:

  ```ts
  interface CommerceStore {
    get(flowToken: string): CommerceSession | undefined;
    set(flowToken: string, s: CommerceSession): void;
    delete(flowToken: string): void;
  }
  // InMemoryCommerceStore: Map + expiresAt, checked lazily on get()
  // ponytail: lazy expiry, no sweeper; add a setInterval sweep if memory matters
  ```

- It's keyed by `flow_token`, not phone number, because the Flow endpoint
  request only carries `flow_token`. The token is a `randomUUID()` minted in
  `COMMERCE_START.onEnter`. The store maps token → `{ userId, cart, … }`,
  and the token is also kept in `session.data.commerceFlowToken` so that
  `COMMERCE_CONFIRM` can find it.
- TTL: 30 min by default, reusing `SESSION_IDLE_MINUTES` rather than adding
  another env var.
- **No Prisma migration needed.** A process restart loses carts, which is
  fine for a demo.

## 4. Reuse vs. missing

**Reusable as-is**
- 24h window: `isWithinWindow()` in `packages/db/src/messages.ts`. Any
  commerce message that isn't a direct reply to an inbound (e.g. a
  delayed "order shipped" push) must check it, the same way `routes/internal.ts` does.
- Message history: `logMessage()` is already called for every inbound
  (engine) and every outbound (`executeAction`). `sendFlow` gets logged for free.
  The admin transcript view (`listMessagesForNumber`, `apps/admin/.../messageSummary.ts`)
  will show unknown types as generic, and teaching it `sendFlow`/`flow_reply`
  is optional.
- Language: `ctx.t()` / `resolveCopy` with en/hi parity enforced by types.
  Note that the copy inside the Flow JSON itself is static per Flow, so a
  Hindi version means a second Flow or passing strings in through `data`
  (see Q4).
- `backToMenuButton`, the global commands, `deliveryTracker` (if a
  "wait for delivery" is ever needed), and the test harness pattern
  (fake `post`).

**Missing**
- The demo safety gate and dataset env vars (none exist today).
- `sendFlow` client method + action kind.
- `nfm_reply` parsing.
- Flow endpoint: route, encryption, signature check, key management.
- **Webhook signature verification**: `POST /webhook` doesn't check
  `X-Hub-Signature-256` today. The Flow endpoint will, and the same helper
  could be applied to `/webhook` (separate decision, see Q7).
- **Phone-number redaction in logs**: `WhatsAppClient.post` currently does
  `console.log(JSON.stringify(body))`, which includes the full `to` number on
  every send. The webhook error logs and Fastify request logs may expose the
  same. This conflicts with the "never log full phone numbers" rule and has to
  be fixed (mask to last 4) before the demo, in the existing code too.
- Fake commerce data, the commerce store, the Flow JSON, and the key scripts.

## 5. Risks and open questions

**Open questions (need your answer)**
1. **What is "commerce" here?** Option A is WhatsApp Flows only (catalog/cart
   screens in a Flow, with the data endpoint), which is what this plan assumes.
   Option B also uses Meta's native catalog messages (`product` /
   `product_list`, `order` webhooks), which need a Commerce Manager catalog
   linked to the WABA. Option C uses `order_details` (India payments), which
   is ruled out by "no real payments" unless it's just a display mock.
2. **What is the `voucher` dataset?** It seems to be the "realistic" branded
   content that must never go out from a protected/production number.
   Please confirm what it contains, so `data.ts` models it right.
3. **Gate scope:** does `DEMO_SEND_ENABLED` / allowlist apply to **commerce
   sends only** (as planned), or to **all** sends? Applying it to all sends
   would block the live certificate service whenever the flag is off.
4. **Hindi inside the Flow:** should it be a single Flow with English only, or
   a Flow that receives strings via `data` from `copy.ts`?
5. **Env var name:** your rules say `WA_PHONE_NUMBER_ID`, but the repo uses
   `PHONE_NUMBER_ID`. The plan is to keep `PHONE_NUMBER_ID` and not add an alias.
6. **Who owns the one-off Graph calls** (public key upload, Flow publish)?
   Scripts (as planned) or methods on the typed client? Your rule "all
   WhatsApp calls go through the one typed client" suggests the client. Then
   the scripts become thin callers, and the client gains a small `postTo(path)` seam.
7. Should signature verification also be added to the existing `/webhook` route
   while we're at it?

**Risks**
- Flow endpoint crypto is easy to get subtly wrong (IV flip, the GCM tag
  appended to the ciphertext, base64 framing). Meta's health check
  `ping` won't pass until it's exact. The round-trip test and the official
  Node example in the Meta docs are the reference.
- The Flow endpoint needs a public HTTPS URL that Meta can reach (the same
  nginx as `/webhook`, `deploy/nginx/app.conf.template` needs a location block) and
  a published Flow. Draft Flows only open for test numbers.
- **Secret hygiene, already a problem:** the committed `.env.example` has a
  real-looking JWT as `VERIFY_TOKEN`, and it carries a personal name in its payload.
  It should be replaced with a placeholder. The new `FLOW_PRIVATE_KEY` must
  never be logged, and the Flow endpoint must not log decrypted payloads
  without masking.
- The in-memory store is single-process only. A restart or second instance loses
  carts, which is acceptable for the demo but stated here so it isn't
  mistaken for production-ready.
- `engine.test.ts` needs a live Postgres. The new `commerce.test.ts` is
  deliberately DB-free so it can run anywhere.
- `CLAUDE.md` is stale (it describes Phase 1 echo). That's worth updating with
  the commerce layout once the work lands.

## Docs to verify against before coding
- Send a Flow message (`interactive.type = "flow"`, `action.parameters`):
  https://developers.facebook.com/docs/whatsapp/flows/guides/sendingaflow
- Flow data endpoint, encryption, health check:
  https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
- `nfm_reply` webhook shape:
  https://developers.facebook.com/docs/whatsapp/flows/reference/responsemsgwebhook
- Encryption public key upload:
  https://developers.facebook.com/docs/whatsapp/cloud-api/reference/whatsapp-business-encryption
- Flows API (create/publish): https://developers.facebook.com/docs/whatsapp/flows/reference/flowsapi
