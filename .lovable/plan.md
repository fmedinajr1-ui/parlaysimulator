# Why the pipeline isn't working

The code is running fine. Every engine downstream is starving because the data sources it depends on are all failing auth or out of quota right now. Evidence from the last few minutes of edge logs:

| Source | Status | Impact |
|---|---|---|
| ScrapingBee (PrizePicks proxy) | `401 Monthly API calls limit reached: 1000` | `pp-props-scraper` fatal — no PrizePicks props ingested |
| PrizePicks direct API | `403` on both `api.prizepicks.com` and `partner-api` | No fallback either |
| Hard Rock Bet event discovery | `401` | `signal-alert-engine` suppresses **all NBA alerts** ("HRB lines unavailable") |
| The Odds API (`team-markets-sync`) | `401` on `basketball_nba`, `baseball_mlb`, `icehockey_nhl` | No team markets sync today |
| `signal-alert-engine` | `active props: 0 raw, 0 after scoring` | Nothing to alert on — direct consequence of above |
| `prop-sharp-sync` | `Found 0 pending picks` | Nothing to settle/track |
| `nfl-stats-fetcher` | `0 games, 0 player logs` | NFL off-season window — expected, non-fatal |
| `telegram-poll` | `502 upstream_request_failed` from connector gateway | Intermittent — Telegram bot can't receive commands during those windows |

Net effect: PrizePicks props can't be loaded → no candidate legs → `signal-alert-engine` finds 0 props → no parlays, no alerts, no Telegram broadcasts. The "AI Betting Systems Intelligence" message in your screenshot is the bot's own status post; it's green because the function booted, but the upstream feeds it summarizes are dark.

# Fix plan (Step 1 — unblock today)

1. **ScrapingBee** — monthly quota of 1000 calls is exhausted. Either upgrade the ScrapingBee plan or rotate to a higher-tier key, then update the `SCRAPINGBEE_API_KEY` secret. Without this, PrizePicks direct also 403s, so the whole prop pool is empty.
2. **Hard Rock Bet** — `[hardrock-lines] event discovery failed 401`. Their endpoint started requiring a different header/token; refresh whatever token `hardrock-lines` uses and re-test. While 401, NBA alerts are deliberately killed by design.
3. **The Odds API** — three sports returned `401`. Either the `ODDS_API_KEY` rotated/expired or monthly credit is gone. Replace the key.
4. **Telegram connector** — the 502s are upstream gateway flakes; add a one-retry backoff in `telegram-poll` so a single 502 doesn't blank a polling cycle.

Until at least #1 and #3 are resolved, no amount of code changes will make picks appear — there is literally nothing in the prop pool.

# Fix plan (Step 2 — health visibility)

Add a small **Data Feed Health** card surfaced on the admin dashboard + a Telegram admin DM when any of these flips to failing in the last 15 minutes:

- ScrapingBee credit remaining (cheap probe / response header)
- Hard Rock event discovery status
- The Odds API last-success timestamp per sport key
- `pp-props-scraper` last successful run + row count

Right now you only learn the feed died when picks stop showing — this surfaces it the moment ScrapingBee or HRB go dark.

# Step 3 — AI Betting Systems Intelligence (the screenshot)

The screenshot describes the modeling families the bot claims to use. Mapping each to what we already have and what's missing:

| Family | Status in our stack | Recommendation |
|---|---|---|
| **Gradient-boosted trees / XGBoost / LightGBM** for prop hit-rate | We use rule-based composite scoring + Bayesian smoothing (`scoring.ts`, `parlayRankingScore`). No tree model. | Train an offline LightGBM model on `prop_results` history per sport×prop_type → output `model_prob`, blend with current composite via logistic stacker (`final = 0.6 * model + 0.4 * composite`). Run nightly, store predictions in a new `model_prop_predictions` table consumed by `parlay-engine-v2`. |
| **Poisson / Dixon-Coles goal models** | Used implicitly for MLB pitcher K and HR (rate-based). Not used for NHL/Soccer scoring lines. | Add a Dixon-Coles fitter for NHL goals (team strength + low-score correlation correction) → feeds `team-markets` totals and moneylines. Soccer expansion would reuse the same module. |
| **Elo / rating systems as inputs** | We don't maintain Elo. We rely on win%, recent form, defense rank. | Add a rolling Elo per team per sport (updated post-settlement). Expose as a feature to both the LightGBM model and the moneyline/H2H engine. Cheap, high signal, gives the model the "strength" prior it's currently missing. |

These are roadmap items, not today-blockers. Order I'd build them: Elo (1 day) → LightGBM stacker for NBA points/rebounds/assists (2–3 days) → Dixon-Coles for NHL (1–2 days).

# What I'd implement first when you approve

A. Pull the failing keys (ScrapingBee, Odds API, Hard Rock) — I'll list them with `fetch_secrets` and ask you to rotate the ones that need it.
B. Add `telegram-poll` retry-on-502.
C. Add the Data Feed Health card + admin alert.

# Technical notes

- No schema changes needed for A/B/C.
- For Step 3, a new table `public.model_prop_predictions(prop_key, sport, model_name, prob, generated_at)` with RLS `admin-only select`, written by a new edge function `train-prop-model` scheduled nightly via `pg_cron`.
- LightGBM in Deno isn't practical — we'd train on a small Python worker (similar to `fanduel-worker`) and write predictions back via service role.
