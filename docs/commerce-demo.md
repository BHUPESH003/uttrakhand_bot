# Commerce demo: from zero to a Flow on your phone

This guide takes you from an empty setup to the commerce-demo Flow opening on a real phone, in order.

Every command runs from the **repository root**. Bot settings live in `apps/bot/.env` (copied from `.env.example` at the root). All data is fake and no real payments happen. Demo messages are sent only when `DEMO_SEND_ENABLED=true` **and** the recipient is listed in `DEMO_ALLOWED_RECIPIENTS`.

The scripts print what they did and Meta's response. They never print the access token, app secret, internal secret or private key, and they mask phone numbers to the last 4 digits.

---

## Phase 0: Meta side (one time, in the browser)

| # | Where | What to get or do | Goes into `apps/bot/.env` |
|---|---|---|---|
| 0.1 | developers.facebook.com → My Apps | A **Business** app with the WhatsApp product added | `META_APP_ID`; and from App settings → Basic, the **app secret** as `META_APP_SECRET` |
| 0.2 | App → WhatsApp → API Setup | The phone number's **Phone number ID** and the **WhatsApp Business Account ID** | `PHONE_NUMBER_ID`, `WABA_ID` |
| 0.3 | Business settings → System users | A **permanent token** with `whatsapp_business_messaging` **and** `whatsapp_business_management` (the second one is needed for Flows, encryption and commerce settings) | `WHATSAPP_TOKEN` |
| 0.4 | API Setup → "To" field | If you use Meta's **test number**, add your own phone as an allowed recipient and verify it with the code | `DEMO_ALLOWED_RECIPIENTS`, `DEMO_TEST_RECIPIENT` (format `919812345678`) |
| 0.5 | App → WhatsApp → Configuration → Webhook | Callback URL `https://<public-host>/webhook`, verify token = your `VERIFY_TOKEN`; subscribe to the **messages** field | `VERIFY_TOKEN` |

Publishing a Flow (Phase 6) also needs a **verified business**. Draft mode doesn't.

## Phase 1: Local bot running on a public HTTPS URL

```bash
pnpm install
docker compose up -d                       # local Postgres
pnpm --filter db migrate:deploy
pnpm --filter db build
cp .env.example apps/bot/.env              # then fill it in (table above + below)
ngrok http 3001                            # or use the VM's domain; note the https URL
```

Put these in `apps/bot/.env` as well:

```dotenv
BOT_PUBLIC_URL=https://<your-ngrok-or-domain>   # endpoint_uri = BOT_PUBLIC_URL + /flows/commerce-demo
DEMO_SEND_ENABLED=true
DEMO_ALLOWED_RECIPIENTS=919812345678            # your phone
DEMO_TEST_RECIPIENT=919812345678
COMMERCE_FLOW_MODE=draft
```

## Phase 2: Keys and encryption

```bash
pnpm --filter bot demo:keys
#   writes apps/bot/.demo-data/keys/{private,public}.pem (git-ignored) and prints the PUBLIC key
#   -> add FLOW_PRIVATE_KEY_PATH=<printed path> to apps/bot/.env

pnpm --filter bot demo:encryption
#   uploads the public key to the phone number, then prints
#   business_public_key_signature_status: VALID   <- must say VALID
```

## Phase 3: Start the bot

```bash
pnpm dev:bot
```

- **Don't expect** the line `commerce-demo Flow endpoint disabled …` in the log. If it's there, `FLOW_PRIVATE_KEY_PATH` or `META_APP_SECRET` is missing.
- **Quick check:** `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<public-host>/flows/commerce-demo -H 'content-type: application/json' -d '{}'` should print **432** (signature check). That proves the route is reachable from outside.

## Phase 4: Create the Flow

```bash
pnpm --filter bot demo:flow:create
#   1. POST /{WABA_ID}/flows  (name, categories [OTHER], endpoint_uri, flow_json) -> Flow id + validation_errors
#   2. POST /{FLOW_ID}        (application_id = META_APP_ID)  -- the app can't be set at create time
#   3. GET  /{FLOW_ID}        status, validation errors, health for this number
#   -> add COMMERCE_FLOW_ID=<printed id> to apps/bot/.env and restart the bot (Ctrl-C, pnpm dev:bot)
```

- **Validation errors:** Meta's validation errors are the source of truth. Fix `apps/bot/flows/commerce-demo.flow.json`, then run `pnpm --filter bot demo:flow:update`.
- **Health check:** Meta now sends health checks. The bot log should show `[flow] ping screen=- -> ok …ms`.

## Phase 5: First Flow on the phone (draft)

Your phone must have messaged the bot in the last 24 hours, so send it "hi" first. Then:

```bash
pnpm --filter bot demo:flow:send --mode draft              # opens on ITEM for brand_a
pnpm --filter bot demo:flow:send --mode draft --screen OTHER_AMOUNT
```

On the phone, tap **Choose amount** and walk through the screens to **Confirm**. The Flow closes and the chat receives the order summary with **Pay (demo)** and **Cancel order**.

Or go through the chat as a customer would: **hi → Proceed → English → More Options → 🛍️ Commerce demo → Buy → Select** on a card.

Other sends:

```bash
pnpm --filter bot demo:send:carousel
pnpm --filter bot demo:send:catalog       # needs Phase 7
```

The send scripts ask the **running bot** to send, through `POST /internal/demo/send`. The Flow's session has to live in the bot process, or the endpoint would answer 427.

## Phase 6: Publish (optional, irreversible)

```bash
pnpm --filter bot demo:flow:publish --yes
#   -> set COMMERCE_FLOW_MODE=published in apps/bot/.env, restart the bot
pnpm --filter bot demo:flow:send --mode published
```

A published Flow can't be edited or deleted, only deprecated. If you need changes after that, clone it into a new Flow.

## Phase 7: Catalog path (optional)

```bash
pnpm --filter bot catalog:csv --link-base https://<your-business-domain>/products/
#   prints the CSV path. Upload it in Commerce Manager -> Catalog -> Data sources, then connect the
#   catalog to the WhatsApp account (WhatsApp Manager -> Catalog).
pnpm --filter bot demo:commerce --cart true --catalog-visible true     # then prints current settings
#   -> COMMERCE_CATALOG_ENABLED=true and COMMERCE_CATALOG_ID=<catalog id> in apps/bot/.env, restart
pnpm --filter bot demo:send:catalog
```

## Changing which screens appear

| Flag | Default | Effect |
|---|---|---|
| `offersScreen` | true | false: the amount goes straight to REVIEW |
| `promoField` | true | false: no promo code box on OFFERS |
| `customAmount` | true | false: no "Other amount" on ITEM or next to the catalog |
| `maxQty` | 10 | Quantity choices 1..maxQty (1 to 20), also caps cart lines |

```bash
pnpm --filter bot demo:config                                   # show
pnpm --filter bot demo:config --set offersScreen=false --set maxQty=5
```

Or use the admin app's **Demo flags** page (`/demo-config`, behind the admin login). It saves through the bot's `/internal/demo-config`.

Each Flow session snapshots the flags when its Flow message is sent. A customer already inside a Flow keeps the screens they started with; the next Flow sent uses the new flags. The flags live in `apps/bot/.demo-data/flow-config.json`, and the running bot picks up changes without a restart.

---

## Failure messages and what they mean

### Bot startup

| You see | Meaning | Fix |
|---|---|---|
| `Invalid environment configuration … DEMO_DATASET=voucher is not allowed on a PHONE_NUMBER_ID listed in PROTECTED_PHONE_NUMBER_IDS` | Safety rule: the voucher dataset must never run on a protected (real) number | Use `DEMO_DATASET=neutral` or another number |
| `COMMERCE_CATALOG_ID is required when COMMERCE_CATALOG_ENABLED=true` | Catalog path on without a catalog | Set the id, or turn the path off |
| Log: `commerce-demo Flow endpoint disabled (set FLOW_PRIVATE_KEY or FLOW_PRIVATE_KEY_PATH, and META_APP_SECRET)` | The Flow endpoint isn't registered; Meta's calls get 404 | Phase 2 + `META_APP_SECRET` |
| `ENOENT … private.pem` | `FLOW_PRIVATE_KEY_PATH` points nowhere | Re-check the path printed by `demo:keys` |

### Scripts

| You see | Meaning | Fix |
|---|---|---|
| `demo:keys`: `… private.pem already exists … Pass --force` | A new key pair would invalidate the uploaded one | Only use `--force` if you'll run `demo:encryption` again |
| `business_public_key_signature_status: MISMATCH` (or not VALID) | Meta couldn't sign or verify the uploaded key | Re-run `demo:encryption`; if it persists, `demo:keys --force` then `demo:encryption` |
| `Meta error 190: …` | Token expired or invalid | New system-user token |
| `Meta error 200: …` / `Meta error 10: …` | Token lacks a permission (usually `whatsapp_business_management`) | Add the permission, regenerate the token |
| `Meta error 100: Invalid parameter` | A wrong id (WABA vs phone number id vs app id) or a malformed field | Check the ids in `.env` |
| `WABA_ID is not set` / `META_APP_ID is not set` / `endpoint URI is not set` | Missing `.env` value (no Meta call was made) | Fill it in |
| `✖ Meta reported N Flow JSON validation error(s): - INVALID_PROPERTY_VALUE: … at screens[0]…` | Meta rejects the Flow JSON | Fix the file, `demo:flow:update` |
| Health: `endpoint_uri: You need to set the endpoint URI …` | Flow has no endpoint | `demo:flow:update --endpoint-uri https://…/flows/commerce-demo` |
| Health: `app_check: You need to connect a Meta app to the flow …` | `application_id` not set | Re-run the app step: `demo:flow:create --force` creates a new Flow, or set it in WhatsApp Manager |
| `Meta error 139001` | Updating a published Flow | Clone it into a new Flow |
| `Meta error 139002` | Publishing a Flow that isn't a draft | It's already published |
| `Could not reach the bot at http://localhost:3001` | Send scripts need the bot running | `pnpm dev:bot`, or `--bot-url` |
| `Bot responded 403 … recipient not in DEMO_ALLOWED_RECIPIENTS` / `DEMO_SEND_ENABLED is not "true"` | The demo send guard blocked it | Add the number / enable sending |
| `Bot responded 502 … catalog path is off` | `demo:send:catalog` without Phase 7 | Phase 7 |

### Sending (Meta errors returned by the bot, or in `failed` statuses in message history)

| Code | Meaning | Fix |
|---|---|---|
| 131030 | Recipient isn't in the test number's allowed list | Phase 0.4 |
| 131047 | More than 24h since the user's last message, so free-form messages aren't allowed | Message the bot first ("hi") |
| 131009 | A parameter value is invalid (our validators should catch length problems first) | Read the message; report it if our validator missed it |
| 131026 | Message undeliverable (old app version, no WhatsApp, etc.) | Try another phone or update WhatsApp |
| 132068 | Flow is blocked (endpoint unhealthy) | Fix the endpoint; Meta re-checks it |
| 132069 | Flow throttled: endpoint unhealthy and 10 sends/hour already used | Fix the endpoint, wait |

### Flow endpoint (bot log `[flow] …`, and what the phone shows)

| Bot log | Phone shows | Meaning | Fix |
|---|---|---|---|
| `signature check failed -> 432` | Generic error | `META_APP_SECRET` isn't the secret of the app connected to the Flow | Use that app's secret |
| `decryption failed -> 421` | Retries with a refreshed key, then generic error | The private key doesn't match the uploaded public key | `demo:encryption` again (same key pair) |
| `data_exchange screen=… -> 427` | "Something went wrong", CTA disabled | Flow token unknown or expired: session older than `SESSION_IDLE_MINUTES`, already completed, or **the bot restarted** (sessions are in memory) | Send a new Flow |
| `client error notification on …: payload-schema-error` | Error on that screen | Our screen data doesn't match the screen's `data` model | Bug; the unit test "screen data matches each screen's declared data model" should catch it |
| `… invalid-screen-transition` | Error | We returned a screen not allowed by `routing_model` | Bug; covered by the routing unit test |
| Webhook alert `public-key-missing` / `public-key-signiture-verification` | Flow won't open | Key not uploaded or signature invalid for this number | `demo:encryption` |
| Webhook alert `timeout_error` | Spinner, then error | Endpoint took more than **10 s** | Check the `[flow] … Nms` times, and the network or tunnel |
| `-> ITEM 1.2ms` (normal) | Next screen | Handler time per screen; compare with the 10 s limit | n/a |

### Chat side

| You see | Meaning |
|---|---|
| "Sorry, the amount picker isn't available right now." | `COMMERCE_FLOW_ID` isn't set in the running bot |
| No "🛍️ Commerce demo" row in More Options | Your number isn't in `DEMO_ALLOWED_RECIPIENTS`, or `DEMO_SEND_ENABLED` isn't `true` |
| "ℹ️ Tap a button above, or type *menu* …" | Unrecognized input inside the demo (expected) |
| "Some cart items aren't part of this demo and were skipped: …" | Cart contained ids that don't map to a demo product, or came from another catalog |
