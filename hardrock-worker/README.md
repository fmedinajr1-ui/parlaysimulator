# hardrock-worker

Self-hosted Hard Rock Bet MLB moneyline scraper. Runs alongside
`fanduel-worker` on the same VPS (different port).

## Why this exists

Hard Rock has no public odds API, geo-locks to specific US states, and is
not in The Odds API US feed. To fill `mlb_fair_price_events.book_id` with
`hardrockbet`, we run a tiny stealth worker on a VPS in a legal HR state,
log in with a burner account, and scrape the internal Kambi-style JSON
endpoint.

## Deploy (same VPS as fanduel-worker)

```bash
cd hardrock-worker
docker build -t hardrock-worker .
docker run -d --name hardrock-worker \
  -p 8081:8081 \
  -e WORKER_SECRET=<shared with edge fn> \
  -e HARDROCK_USER=<email> \
  -e HARDROCK_PASS=<password> \
  --restart unless-stopped \
  hardrock-worker
```

## Endpoints

- `GET /health` → `{ok:true,ts}`
- `POST /scrape-hardrock-mlb-ml` (Bearer `WORKER_SECRET`) →
  `{ ok, ms, events: [{event_id,start_time,home_team,away_team,home_price,away_price,captured_at}] }`

## Notes

- Login is best-effort. If HR forces email MFA, disable it on the burner
  account or whitelist the VPS IP.
- If HR rotates the Kambi path, update `HR_ODDS_URL` in
  `src/hardrock-client.js`.