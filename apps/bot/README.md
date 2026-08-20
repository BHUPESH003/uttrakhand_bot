# apps/bot

Fastify server that receives WhatsApp messages via Meta's Cloud API and (for
now) echoes them back.

## 1. Env setup

```bash
cp ../../.env.example .env
```

Then fill in `.env` (in this `apps/bot/` directory):

- `WHATSAPP_TOKEN` — Meta dashboard > WhatsApp > API Setup > "Temporary
  access token" (valid ~24h; swap for a permanent System User token later).
- `PHONE_NUMBER_ID` — same page, "Phone number ID" (a numeric ID, not the
  actual phone number).
- `VERIFY_TOKEN` — make up any string. You'll enter the *same* value in the
  Meta dashboard in step 3.
- `GRAPH_API_VERSION` — defaults to `v21.0`, fine to leave as-is.
- `WEB_FORM_URL` / `BANNER_IMAGE_URL` — not used by the echo yet, but
  `config.ts` validates them now so phase 2 doesn't need new setup. Any
  valid URL works for now (see `.env.example`).
- `PORT` — defaults to `3000`.

Missing or invalid values throw a clear error listing exactly what's wrong
when the server starts — check the terminal output.

## 2. Run it

From the repo root:

```bash
pnpm install
pnpm dev:bot
```

This runs `apps/bot` with `tsx watch`, so it restarts on file changes. You
should see `Bot listening on http://0.0.0.0:3000` (or your `PORT`).

## 3. Expose it with ngrok + register the webhook

Meta needs to reach your local server over HTTPS, so tunnel it:

```bash
ngrok http 3000
```

Copy the `https://....ngrok-free.app` URL it prints.

In the [Meta App Dashboard](https://developers.facebook.com/apps):

1. Your app > **WhatsApp > Configuration**.
2. Under **Webhook**, click **Edit**.
3. **Callback URL**: `https://<your-ngrok-domain>/webhook`
4. **Verify token**: the exact same string you put in `VERIFY_TOKEN`.
5. Click **Verify and save**. Meta calls `GET /webhook` with that token; if
   it matches, this succeeds immediately (that's the "verification
   handshake" `routes/webhook.ts` handles).
6. Still on that page, click **Manage** next to webhook fields and subscribe
   to the **messages** field (this is what actually delivers incoming
   messages to your webhook — verifying the URL alone isn't enough).

Note: every time you restart ngrok on the free plan, the URL changes and you
must repeat steps 2-5 with the new URL.

## 4. Manual test

1. On the **API Setup** page in the Meta dashboard, add your own WhatsApp
   number as a test recipient (Meta requires this allowlist step outside of
   a fully live app).
2. From your phone, send any message to the business number shown in the
   dashboard.
3. Expect, within a couple seconds:
   - Blue double-checkmark "read" receipt on your message.
   - A reply: `You said: <your message>`.
4. Check the terminal running `pnpm dev:bot` — you'll see every outgoing
   Graph API request/response logged (`[whatsapp] -> ...` / `[whatsapp] <-
   ...`), plus Fastify's request logs.
5. To test button/list replies once those are wired up elsewhere: tapping a
   button or list row should echo back `You picked: <button/row title>`.

### Troubleshooting

- **403 on webhook verification**: `VERIFY_TOKEN` in `.env` doesn't match
  what you typed into the dashboard. They must be byte-for-byte identical.
- **No message arrives at all**: you likely skipped subscribing to the
  `messages` field in step 3.6, or your phone number isn't in the test
  recipients list (step 4.1).
- **`[whatsapp] <- 401 ...`** in the logs: `WHATSAPP_TOKEN` expired
  (temporary tokens last ~24h) or is wrong — generate a fresh one.
