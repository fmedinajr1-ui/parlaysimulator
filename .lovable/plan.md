## Switch FanDuel boost scraper to ScrapingAnt (free) as primary

ScrapingAnt's free tier gives **10,000 API credits/month** with full headless Chrome rendering and anti-bot proxies — enough to comfortably cover the FanDuel boost scans (every 30 min, 9am–11pm ET ≈ 850 runs/mo, well under quota even at 10 credits/page).

### What changes

**1. New secret**
- Add `SCRAPINGANT_API_KEY` (you'll grab a free key at [scrapingant.com](https://scrapingant.com) — no credit card needed).

**2. Refactor `supabase/functions/fanduel-boost-scanner/index.ts`**

New scrape priority chain:

```text
ScrapingAnt (free, JS render, residential proxies)
   ↓ on quota / 5xx / empty body
ScrapingBee  (existing, when quota resets)
   ↓ on 401 quota / failure
Firecrawl    (existing, last resort)
```

- Add `scrapingAntFetchWithRetry(url, attempt)`:
  - Endpoint: `https://api.scrapingant.com/v2/general`
  - Params: `url`, `x-api-key=<SCRAPINGANT_API_KEY>`, `browser=true`, `proxy_type=residential`, `proxy_country=US`, `wait_for_selector` for boost cards, `return_text=true`
  - Same exponential backoff (1s → 2s → 4s → 8s + jitter, max 4 attempts)
  - UA rotation across attempts
  - Treat HTTP 423 (rate-limited) and 5xx as retryable; treat 401/402 (quota) as hard-fail → fall through to next provider
- Update `scrapePage()` orchestrator to try ScrapingAnt first, then ScrapingBee, then Firecrawl. Reuse the existing `succeededLogical` Set so we stop once `/promos` and `/boosts` each succeed.
- Keep `htmlToText()` normalization unchanged — ScrapingAnt returns raw HTML.
- Log which provider actually delivered the bytes (e.g. `[scanner] /promos via scrapingant in 4823ms`).

**3. No DB or schema changes.** Tables, RLS, cron schedules, grader, and Telegram sender stay as-is.

**4. Deploy + verify**
- Deploy `fanduel-boost-scanner`.
- Manually invoke it once and check logs to confirm:
  - ScrapingAnt returns HTML for `/promos` and `/boosts`
  - Boost cards parse into rows in `fanduel_boosts`
  - On a forced failure, fallback chain still works.

### What stays the same
- Grader (`fanduel-boost-grader`) and Telegram sender (`fanduel-boost-telegram`) untouched.
- Existing ScrapingBee + Firecrawl secrets remain — used as fallbacks only.
- Cron schedule unchanged (`*/30 9-23 * * *`).

### What you need to do
1. Sign up at [scrapingant.com](https://scrapingant.com) (free, ~30 sec, no card).
2. Copy your API key from the dashboard.
3. When I prompt for the secret, paste it in.

After that I'll wire everything up and run a live test.