# "Chat with us" (AI handoff) — ops runbook

Quick reference for configuring and debugging the AI service integration
(`apps/bot/src/ai/`, `apps/bot/src/flow/aiChat.ts`). Contract/schema lives
in `ai-handoff-contract.html` at the repo root — this doc is just the
"how do I run/debug it" side.

## Env vars

Only `apps/bot` talks to the AI service — `apps/web` and `apps/admin` never
need these. Add them to `apps/bot/.env` on the VM (real file, not
`.env.example`), same as `WHATSAPP_TOKEN`:

```
AI_SERVICE_URL=https://example.com/uk-eseva
AI_SERVICE_TOKEN=<shared secret from the AI team>
```

**`AI_SERVICE_URL` must be the base URL only, no path suffix.** The bot
appends `/v1/converse` itself (`apps/bot/src/ai/client.ts`):

```ts
fetch(`${config.AI_SERVICE_URL}/v1/converse`, ...)
```

If the AI team's real endpoint is `https://cachatbot.pelocal.net/uk-eseva/v1/converse`,
set `AI_SERVICE_URL=https://cachatbot.pelocal.net/uk-eseva` — putting the
full path (including `/v1/converse`) in the env var doubles it up into
`.../v1/converse/v1/converse`.

Config is validated once at boot (`apps/bot/src/config.ts`) — a missing or
malformed value crashes the bot on startup with a clear message, rather
than failing silently mid-request.

After editing `apps/bot/.env`:
```bash
sudo systemctl restart uttarakhand-bot
```

## Viewing bot logs

```bash
sudo journalctl -u uttarakhand-bot -f              # live tail
sudo journalctl -u uttarakhand-bot -n 200          # last 200 lines
sudo journalctl -u uttarakhand-bot --since "10 min ago"
```

## Confirming the AI API is actually getting hit

`ai/client.ts` logs every attempt, mirroring `whatsapp/client.ts`'s
existing `[whatsapp] -> POST ...` / `[whatsapp] <- ...` pattern:

```
[ai-chat] -> POST https://.../v1/converse {"contractVersion":"1.0", ...}
[ai-chat] <- 200 {"messages":[...], "control": {...}, ...}
```

While tailing `journalctl -u uttarakhand-bot -f`, tap "Chat with us" and
send a message, then read the sequence:

- `->` line appears, `<-` line follows with `200` — request reached the AI
  service and it replied. If no WhatsApp message shows up after that,
  the bug is on the bot's rendering side (a block violating Meta's limits
  — check for a `[ai-chat] failed to render AI response` line right after).
- `->` line appears, then `[ai-chat] AI service call failed ...` instead of
  a `<-` line — the request went out but errored or timed out (25s budget).
  Check `AI_SERVICE_URL` reachability from the VM and whether the AI
  team's endpoint is actually up.
- No `->` line at all after tapping "Chat with us" and sending a message —
  the message never reached `handleAiChatTurn` at all. Confirm the session
  is actually in the `AI_CHAT` state (e.g. the automated-assistant
  disclosure text was sent right after tapping the menu row).

Fallback if you don't have log access: every attempt is also logged to
Postgres, request before the call and response only on success —
```bash
docker exec -it uttrakhand_bot-postgres-1 psql -U uttarakhand_bot -d uttarakhand_bot \
  -c "select type, direction, \"createdAt\" from \"MessageLog\" where type in ('ai_request','ai_response') order by \"createdAt\" desc limit 10;"
```
An `ai_request` row with no matching `ai_response` right after it means the
call was made but never came back successfully.
