# hardrock-worker

Self-hosted Hard Rock Bet stealth scraper. Runs alongside `fanduel-worker`
on a VPS located in a US state where Hard Rock is licensed (NJ, AZ, FL,
IN, IA, OH, TN, VA…). Powers MLB moneyline ingestion and NBA player-prop
gating without depending on a paid odds aggregator (HR is not in The Odds
API).

## Endpoints

| Method | Path           | Auth                              | Returns                                   |
| ------ | -------------- | --------------------------------- | ----------------------------------------- |
| GET    | `/health`      | public                            | `{ok,ts,supabase,auth}` liveness probe    |
| POST   | `/scrape/mlb`  | `Bearer HARDROCK_WORKER_SECRET`   | `{ok,ms,events,upload}` MLB moneylines    |
| POST   | `/scrape/nba`  | `Bearer HARDROCK_WORKER_SECRET`   | `{ok,ms,props,upload}` NBA player props   |

`POST /scrape/nba` accepts `{ "maxEvents": 20 }` (clamped to 40) to cap
per-event fanout. When `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are
set, each `/scrape/*` call also inserts rows directly into
`market_snapshot` (sportsbook=`hardrockbet`).

## Environment

| Var                          | Required | Purpose                                                    |
| ---------------------------- | -------- | ---------------------------------------------------------- |
| `PORT`                       | no       | Defaults to `8081`.                                        |
| `HARDROCK_WORKER_SECRET`     | **yes**  | Shared Bearer token. Must match the edge-function secret.  |
| `HARDROCK_USER`              | no       | HR burner-account email. Enables logged-in session.        |
| `HARDROCK_PASS`              | no       | HR burner-account password.                                |
| `SUPABASE_URL`               | no       | If set, worker uploads snapshots directly.                 |
| `SUPABASE_SERVICE_ROLE_KEY`  | no       | Service-role key for the direct-upload path.               |

`HARDROCK_WORKER_URL` and `HARDROCK_WORKER_SECRET` are also configured in
Lovable Cloud as edge-function secrets. The Lovable-side values are
placeholders until you point them at your VPS (see below).

## VPS deployment

Tested on Ubuntu 22.04 (Hetzner / Fly machines / DigitalOcean droplets in
a HR-legal US state). Any host that can run a Docker container works.

### 1. Install Docker (one-time)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out + back in so the docker group takes effect
```

### 2. Clone repo and build the image

```bash
git clone <your-repo-url> app && cd app/hardrock-worker
docker build -t hardrock-worker .
```

### 3. Run the container (replace placeholders)

```bash
docker run -d --name hardrock-worker \
  --restart unless-stopped \
  -p 8081:8081 \
  -e HARDROCK_WORKER_SECRET='<PUT_YOUR_SECRET_HERE>' \
  -e HARDROCK_USER='<burner@example.com>' \
  -e HARDROCK_PASS='<password>' \
  -e SUPABASE_URL='https://<project-ref>.supabase.co' \
  -e SUPABASE_SERVICE_ROLE_KEY='<service-role-key>' \
  hardrock-worker

docker logs -f hardrock-worker   # confirm: "[hr-worker] listening on :8081"
```

### 4. Put it behind HTTPS (Caddy, one-liner)

```bash
# /etc/caddy/Caddyfile
hardrock.<your-domain.com> {
  reverse_proxy localhost:8081
}

sudo systemctl reload caddy
```

### 5. Point Lovable Cloud at the worker

Update the project secrets in Lovable Cloud → Settings → Secrets:

- `HARDROCK_WORKER_URL` = `https://hardrock.<your-domain.com>` (no trailing slash)
- `HARDROCK_WORKER_SECRET` = same value you put in the container env

The `mlb-hardrock-ml-bridge` edge function (already deployed) will start
returning `inserted > 0` within 30s, and `mlb_fair_price_events.book_id`
will begin showing `hardrockbet`.

### 6. Smoke-test

```bash
curl https://hardrock.<your-domain.com>/health
# → {"ok":true,"ts":...,"supabase":true,"auth":true}

curl -X POST https://hardrock.<your-domain.com>/scrape/mlb \
  -H "Authorization: Bearer <PUT_YOUR_SECRET_HERE>"
# → {"ok":true,"ms":...,"events":[...],"upload":{"uploaded":N}}

curl -X POST https://hardrock.<your-domain.com>/scrape/nba \
  -H "Authorization: Bearer <PUT_YOUR_SECRET_HERE>" \
  -H "Content-Type: application/json" -d '{"maxEvents":10}'
```

## Operational notes

- Login is best-effort. If HR forces email MFA the session falls back to
  guest cookies — most odds pages still respond. Disable MFA on the
  burner account or whitelist the VPS IP for the cleanest path.
- If HR rotates the Kambi paths, update `HR_MLB_URL` in `src/scrape-mlb.js`
  and `HR_NBA_LIST` / `HR_EVENT_OFFERS` in `src/scrape-nba.js`.
- The browser context is warm-cached for 30 min between scrapes so repeat
  calls cost ~200-500ms each instead of a cold 12s.