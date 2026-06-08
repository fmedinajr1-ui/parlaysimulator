## Goal

Self-hosted Hard Rock Bet MLB moneyline scraper so `mlb_fair_price_events.book_id` and the pre-game latency table include `hardrockbet` alongside FanDuel/DK/etc.

## Architecture

```text
[hardrock-worker container]  -- runs alongside fanduel-worker on the same VPS
  POST /scrape-hardrock-mlb-ml
    1. Reuse cached HR session cookie (login on cold start with HARDROCK_USER / HARDROCK_PASS)
    2. Hit HR's internal JSON odds endpoint for MLB h2h (reverse-engineered from devtools)
    3. Return normalized JSON: [{ game, home_team, away_team, home_price, away_price, captured_at }]

[Supabase edge fn: mlb-hardrock-ml-bridge]  -- every 30s via pg_cron
    1. fetch worker /scrape-hardrock-mlb-ml with WORKER_SECRET
    2. Resolve each (away@home) to today's MLB gamePk via statsapi.mlb.com
    3. Insert two rows per game into market_snapshot
       (sportsbook='hardrockbet', market_type='live_ml', game_id='mlb_<pk>')
    4. Silent retry on failure — log to console, no Telegram noise

[Existing scout-live-edge]  -- unchanged
    Already picks `top.sportsbook` by latest captured_at, so HR rows
    will naturally land in mlb_fair_price_events.book_id whenever
    HR posts a fresher line than the other books.
```

## File changes

### New worker service
- `hardrock-worker/Dockerfile` — mirror of fanduel-worker, Playwright + stealth
- `hardrock-worker/package.json` — same deps as fanduel-worker
- `hardrock-worker/src/server.js` — Express on `:8081`, endpoints:
  - `GET /health`
  - `POST /scrape-hardrock-mlb-ml` (Bearer `WORKER_SECRET`)
- `hardrock-worker/src/hardrock-client.js` — login + JSON-endpoint client
  - Logs in once with `HARDROCK_USER` / `HARDROCK_PASS`, persists cookies in-memory
  - 401 → re-login once, then surface error
  - Reverse-engineered JSON endpoint with documented field mapping
- `hardrock-worker/README.md` — deploy notes (same VPS, port 8081, env vars)

### Supabase edge function
- `supabase/functions/mlb-hardrock-ml-bridge/index.ts` — same shape as `mlb-live-ml-bridge`, but pulls from `HARDROCK_WORKER_URL` instead of The Odds API
- `supabase/functions/mlb-hardrock-ml-bridge_test.ts` — 5 unit tests per testing-policy memory: (a) team-name normalization, (b) unmatched event drop, (c) row shape, (d) empty worker response → 0 inserts, (e) worker 5xx → silent retry signal

### Cron
- `supabase--insert` to register `mlb-hardrock-ml-bridge-30s` pg_cron job (same cadence/window as `mlb-live-ml-bridge-30s`, 10:00–02:00 ET)

### Secrets (request via `add_secret`)
- `HARDROCK_USER` — HR account email
- `HARDROCK_PASS` — HR account password
- `HARDROCK_WORKER_URL` — `https://your-vps.host:8081` (set after worker deploys)
- `HARDROCK_WORKER_SECRET` — shared Bearer for the edge function → worker call (re-use FanDuel's value or new, your call)

### Plan doc
- Update `.lovable/plan.md` with the new bridge so the Hard Rock "out of scope" note is removed.

## Out of scope (this ticket)

- Player-prop ingestion from Hard Rock (only MLB h2h here). The existing `_shared/hardrock-lines.ts` for NBA props is unaffected.
- VPS provisioning — assumes the FanDuel worker box stays up; we just add a second container.
- Backfill — only new `mlb_fair_price_events` rows get `book_id='hardrockbet'`.

## Verification

1. `curl https://<vps>:8081/health` → `{ok:true}`
2. Run worker `/scrape-hardrock-mlb-ml` manually → returns ≥1 MLB game with prices
3. Manually invoke `mlb-hardrock-ml-bridge` edge fn → `{ok:true, matched, inserted}`
4. `SELECT * FROM market_snapshot WHERE sportsbook='hardrockbet' ORDER BY captured_at DESC LIMIT 5;` → rows present
5. Wait ~2 min for `scout-live-edge` tick → `SELECT book_id, count(*) FROM mlb_fair_price_events WHERE created_at > now()-interval '5 min' GROUP BY 1;` should show `hardrockbet` appearing

## Risks & mitigations

- **HR rotates endpoint paths / adds bot challenge** → wrap fetch in worker with one Playwright-fallback path that loads the live MLB page and scrapes the embedded JSON; logged but not auto-enabled.
- **Login MFA / device check** → if HR forces MFA, worker login will fail loudly in `/health`; you'll need to whitelist the VPS IP in your HR account or disable email-MFA on that account.
- **TOS** — scraping HR while logged in is a grey area; using a dedicated burner account scoped to read-only odds pages keeps blast radius small.
