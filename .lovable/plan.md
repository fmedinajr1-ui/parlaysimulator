## Force ScrapingBee to fully render FanDuel boost pages

The scanner already requests `render_js=true` + `premium_proxy=true`, but FanDuel still returns the ~2KB JavaScript bootloader because:

1. ScrapingBee uses `wait=5000` + `wait_browser=networkidle2`. FanDuel's SPA mounts boost cards **after** Akamai's JS challenge resolves and an XHR returns — `networkidle2` fires too early on this app.
2. `block_resources=false` is set, but no CSS selector is required to be present before snapshot, so we capture the shell.
3. No JS scenario is run, so we don't scroll or wait for the boost grid.

### Changes — `supabase/functions/fanduel-boost-scanner/index.ts`

**1. Upgrade `scrapingBeeFetch` to wait for actual boost content**

Replace the params with a stricter rendering recipe:

```text
render_js          = true
premium_proxy      = true              (stealth_proxy on retry)
country_code       = us
wait_for           = '[data-test-id*="boost"], [class*="Boost"], a[href*="/boost"]'
wait               = 8000              (fallback if selector never matches)
block_resources    = false
return_page_source = true              (post-render DOM, not pre-render HTML)
js_scenario        = JSON instructions: scroll 3x with 800ms pauses, then wait 1500ms
```

`js_scenario` makes ScrapingBee run real interactions inside the headless browser before snapshotting — this is what triggers FanDuel's lazy-loaded boost grid to mount.

**2. Treat the JS-stub response as a retryable failure**

Right now `html.length > 500` passes the check even when we got the bootloader. Add a content sanity gate inside `scrapingBeeFetch`:

```text
if html length < 15_000  → treat as miss
if html does not contain any of: "boost", "odds", "parlay", "promo" → treat as miss
```

A miss returns `{ html: null, status: 200 }` so `scrapingBeeFetchWithRetry` retries (and flips to `stealth_proxy` on the final attempt, as today).

**3. Bump retry count and stealth ordering**

- `maxAttempts` 3 → 4
- Attempt 1: `premium_proxy`
- Attempt 2: `premium_proxy` (different UA via `forward_headers`)
- Attempt 3: `stealth_proxy`
- Attempt 4: `stealth_proxy` + longer `wait` (12000ms)

**4. Logging**

Log the rendered HTML byte size and whether the keyword gate matched, so future failures are diagnosable from a single line:
`scrapingbee /promos -> 248K bytes, hit "boost" keyword, 23 cards likely`.

### Cost impact

ScrapingBee charges per credit:
- `render_js=true` = 5 credits
- `premium_proxy=true` = 25 credits (10 with stealth_proxy)
- `js_scenario` = no extra cost
- 4 attempts × 2 URLs (`/promos`, `/boosts`) × every 30 min, 9am–11pm ET ≈ ~6,800 credits/day worst case (typical: ~1,700/day with first-attempt success)

This is well within the standard ScrapingBee plan you already pay for.

### Verification after deploy

1. Deploy `fanduel-boost-scanner`.
2. Manually invoke it once.
3. Check logs for:
   - `scrapingbee /promos in <ms>ms (<chars> chars)` with chars > 30,000
   - `aiExtractBoosts` returning > 0 boosts
   - New rows in `fanduel_boosts` for today
4. If still empty, inspect logs for which keyword check failed and we'll iterate on the selector list.

### What stays the same
- Anthropic Claude Haiku 4.5 as the parser (working).
- ScrapingAnt + Firecrawl as fallbacks.
- Self-hosted worker path (still preferred when `FANDUEL_WORKER_URL` is set).
- DB schema, cron schedule, grader, Telegram sender — unchanged.
- No new secrets needed.