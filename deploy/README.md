# Deploying to production

Architecture: `apps/web` on Vercel, `apps/bot` + `apps/admin` on one VM
behind nginx (sharing a single domain, split by path), one shared Postgres
reachable from both (Neon recommended — see "Database" below). This
directory automates the VM side; Vercel's own git integration handles
`apps/web`.

```
apps/web    -> Vercel (git-connected, auto-deploys on push)
apps/bot    -> VM, systemd unit uttarakhand-bot,   nginx -> DOMAIN/
apps/admin  -> VM, systemd unit uttarakhand-admin, nginx -> DOMAIN/admin
Postgres    -> Neon (or any reachable Postgres — just a DATABASE_URL)
```

Single domain, split by path, rather than two subdomains: `apps/admin`'s
`next.config.ts` sets `basePath: "/admin"` in production builds, and
`deploy/nginx/app.conf.template` routes `/admin/*` to it and everything
else to the bot. If you'd rather use two subdomains instead (no basePath,
one nginx server block per domain), that's a simpler setup — this guide
just documents the single-domain path this repo is wired for.

**Why not `apps/admin` on Vercel too:** it writes generated certificate
PDFs to `public/certificates/` on the local filesystem at request time.
Vercel's serverless functions don't have a writable, persistent filesystem
outside `/tmp` — that write would silently fail or vanish. Either keep
admin on the VM (what this guide does) or first switch `pdf.ts` to upload
to object storage (S3/R2/Vercel Blob) if you want it on Vercel anyway.

## Prerequisites

- This repo pushed to a git remote (GitHub/GitLab/etc.) — Vercel deploys
  from git, and the VM scripts `git fetch`/`reset` from origin too.
- A VM (any Ubuntu/Debian box) with a public IP, reachable over SSH, with
  ports 80/443 open in whatever firewall/security-group sits in front of it
  (that part is provider-specific — these scripts don't touch cloud
  firewall rules).
- One DNS name (e.g. `yourdomain.com`) you can point at that VM's IP —
  both apps share it, split by path (see above).
- A Postgres `DATABASE_URL` reachable from both the VM and Vercel (Neon's
  **pooled** connection string — see below).
- Real values for every app's `.env.example` (WhatsApp token, admin
  password, the shared `INTERNAL_API_SECRET`, etc.) — these scripts never
  invent secrets, they only build/run/proxy what you configure.

### Database: use Neon's pooled connection string

Serverless functions (Vercel) open a new DB connection per invocation —
Neon's pooler is built for exactly that and avoids exhausting Postgres's
connection limit. Use the pooled string (the one Neon's dashboard labels
"Pooled connection") for `apps/web` and `apps/admin`'s `DATABASE_URL`; the
bot can use either, since it's a long-lived process.

Neon's free tier auto-suspends its compute after ~5 minutes with no
active queries, and the next query pays a cold-start delay. `apps/bot`
runs 24/7 already, so it now pings the database every 4 minutes
(`packages/db`'s `pingDatabase()`, called from `apps/bot/src/index.ts`) —
comfortably under that 5-minute window, which keeps the compute warm for
`apps/web` and `apps/admin` too, since all three share the same Neon
project. No separate cron job needed. This is a no-op cost against an
always-on Postgres.

## One-time setup

**1. Database**
```bash
# from your own machine, against the real DATABASE_URL
DATABASE_URL='<neon-pooled-url>' pnpm --filter db migrate:deploy
DATABASE_URL='<neon-pooled-url>' pnpm --filter db seed   # optional sample data
```

**2. VM: clone + bootstrap**
```bash
ssh you@your-vm
sudo mkdir /uttarakhand-bot && sudo chown "$(whoami)" /uttarakhand-bot
git clone <your-repo-url> /uttarakhand-bot
cd /uttarakhand-bot
cp deploy/.env.deploy.example deploy/.env.deploy
nano deploy/.env.deploy   # fill in the real domain/ports/email

sudo ./deploy/scripts/01-vm-bootstrap.sh
```
This installs Node 20, pnpm, nginx, certbot, creates a dedicated
`uttarakhand` system user (never runs the app as root), and installs the
two systemd units — enabled, not started yet.

**3. Real env files on the VM**
```bash
cp apps/bot/.env.example apps/bot/.env            && nano apps/bot/.env
cp apps/admin/.env.example apps/admin/.env.local  && nano apps/admin/.env.local
```
Fill in real values — `INTERNAL_API_SECRET` must be byte-for-byte
identical across `apps/bot`, `apps/admin`, and `apps/web`. `WEB_FORM_URL`
(bot's env) is your Vercel URL from step 5. `ADMIN_PUBLIC_URL` (admin's
env) is `https://<DOMAIN>/admin` (note the `/admin` — this app is
reverse-proxied at that path, not the domain root) — it gets baked into
every generated certificate's public URL.

**4. First deploy of each VM app**
```bash
sudo ./deploy/scripts/02-deploy-bot.sh
sudo ./deploy/scripts/03-deploy-admin.sh
```
Each builds only what it needs, applies pending Prisma migrations,
restarts its systemd service, and polls its local port until it answers —
failing loudly with the `journalctl` command to run if it doesn't.

**5. `apps/web` on Vercel**
- Vercel dashboard → Add New Project → import your repo → set **Root
  Directory** to `apps/web`.
- Since this is a plain pnpm workspace (not Turborepo), set the **Build
  Command** explicitly so the workspace packages build first:
  ```
  pnpm --filter types build && pnpm --filter db build && pnpm --filter theme build && pnpm --filter web build
  ```
- Add env vars in the project settings (or use the script below):
  `DATABASE_URL`, `BOT_INTERNAL_URL` (`https://<DOMAIN>`),
  `INTERNAL_API_SECRET`.
- Deploy. Copy the resulting URL into `apps/bot/.env`'s `WEB_FORM_URL`,
  then re-run `sudo ./deploy/scripts/02-deploy-bot.sh` on the VM to pick it up.

Alternative to the dashboard, from your own machine:
```bash
cp apps/web/.env.example apps/web/.env.production.local
nano apps/web/.env.production.local   # real values
./deploy/scripts/05-deploy-web-vercel.sh
```
`vercel link` (run automatically, first time only) asks a couple of
questions interactively — that's expected. The script then pushes every
var from that file into Vercel's production environment and deploys.

**6. nginx + TLS**
Point `DOMAIN`'s DNS A record at the VM's IP *before* this step — Let's
Encrypt's challenge needs it to already resolve.
```bash
sudo ./deploy/scripts/04-setup-nginx-tls.sh
```
Installs the reverse-proxy config (bot at `/`, admin at `/admin`), then
runs `certbot --nginx` to obtain a certificate and add the HTTPS redirect.
Certbot installs its own renewal timer — nothing further to do for
renewals.

**7. Register the real webhook with Meta** (replaces the old ngrok URL)
```bash
curl -X POST "https://graph.facebook.com/v21.0/{APP_ID}/subscriptions" \
  -d "object=whatsapp_business_account" \
  -d "callback_url=https://<DOMAIN>/webhook" \
  -d "verify_token={VERIFY_TOKEN}" \
  -d "fields=messages" \
  -d "access_token={APP_ID}|{APP_SECRET}"
```

## Redeploying after future changes

- Bot changed: `sudo ./deploy/scripts/02-deploy-bot.sh` on the VM.
- Admin changed: `sudo ./deploy/scripts/03-deploy-admin.sh` on the VM.
- Web changed: push to your connected git branch (Vercel auto-deploys), or
  `./deploy/scripts/05-deploy-web-vercel.sh` from your machine.
- Domains/ports changed: edit `deploy/.env.deploy`, re-run
  `04-setup-nginx-tls.sh`.

## Troubleshooting

- `journalctl -u uttarakhand-bot -n 100 -f` / `-u uttarakhand-admin` — live
  logs for either service.
- `sudo nginx -t` — validate nginx config without reloading.
- `sudo systemctl status uttarakhand-bot` — is it even running, and why not.
- `sudo certbot certificates` — check what's issued and when it expires.
- A 502 from nginx almost always means the Node service itself isn't
  running or crashed on boot — check `journalctl` before touching nginx.
