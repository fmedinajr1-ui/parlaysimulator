
# Court.Edge — Headless Tennis Edge Engine → Telegram

No UI. A fully server-side pipeline (Supabase Edge Functions + cron) that runs daily, computes total-games edges for ATP/WTA props, and pushes a ranked board into the existing Telegram bot.

---

## Pipeline shape

```text
cron (twice daily)
  → court-edge-run
      ├── court-edge-fetch-odds         (The Odds API, server-side)
      ├── court-edge-fetch-prizepicks   (PrizePicks API, server-side)
      ├── court-edge-scrape-l3          (TennisAbstract, 24h cache, 3 concurrent)
      ├── court-edge-fetch-weather      (Open-Meteo, 1h cache)
      ├── projection engine (in-process)
      ├── persist run + picks to court_edge_runs
      └── send formatted digest via existing bot-send-telegram
```

The screenshot/paste fallback path from the original spec is dropped (it required a UI). PrizePicks API + Odds API are the two prop sources.

---

## 1. Database (migration)

```text
court_edge_l3_cache
  player_slug TEXT PK
  totals      INT[]
  raw_scores  JSONB
  fetched_at  TIMESTAMPTZ

court_edge_weather_cache
  city        TEXT PK
  temp_f      NUMERIC
  humidity    NUMERIC
  wind_mph    NUMERIC
  fetched_at  TIMESTAMPTZ

court_edge_runs
  id          UUID PK
  ran_at      TIMESTAMPTZ
  source      TEXT          -- 'cron' | 'manual'
  log         JSONB         -- streamed pipeline log
  picks       JSONB         -- ranked prop list
  picks_count INT
  errors      JSONB

court_edge_picks
  id          UUID PK
  run_id      UUID FK
  source      TEXT          -- 'odds_api' | 'prizepicks'
  matchup     TEXT
  player      TEXT
  market      TEXT          -- 'match_total' | 'player_total_games'
  line        NUMERIC
  projection  NUMERIC
  edge        NUMERIC
  edge_pct    NUMERIC
  verdict     TEXT          -- STRONG_OVER | LEAN_OVER | PASS | LEAN_UNDER | STRONG_UNDER
  formula     JSONB         -- per-factor breakdown
  tournament  TEXT
  surface     TEXT
  sets_format TEXT
  indoor      BOOLEAN
  weather     JSONB
  commence_at TIMESTAMPTZ
  created_at  TIMESTAMPTZ
  graded      BOOLEAN DEFAULT false
  result      TEXT          -- 'W' | 'L' | 'PUSH' (filled later)
```

RLS: cache tables readable by authenticated, writable only by service role. Runs/picks readable by service role only (admin).

---

## 2. Secrets

| Secret | Source | Purpose |
|---|---|---|
| `ODDS_API_KEY` | user adds via `add_secret` | The Odds API |
| `LOVABLE_API_KEY` | auto | (not used here, but available) |
| `TELEGRAM_BOT_TOKEN` | already set | reused via `bot-send-telegram` |
| `TELEGRAM_CHAT_ID` | already set | reused |

I'll use `add_secret` for `ODDS_API_KEY` at the start of build mode and wait for it before deploying.

---

## 3. Edge functions

### `court-edge-fetch-odds`
- Lists active tennis sports (`/v4/sports?all=false` filtered by key contains "tennis").
- For each, fetches `markets=totals,h2h&regions=us&oddsFormat=american`.
- Returns events for next 48h with `home_team`, `away_team`, totals point, h2h American odds.

### `court-edge-fetch-prizepicks`
- `GET https://api.prizepicks.com/leagues` → tennis league IDs.
- `GET /projections?league_id=<id>&per_page=250` for each.
- Filters `stat_type` = "Total Games" (or equivalent player-level market).
- Returns `{player, opponent, line, start_at}`.

### `court-edge-scrape-l3`
- Input: list of player names.
- For each: normalize slug (strip accents, capitalize, concat — e.g. "Stéfanos Tsitsipás" → "StefanosTsitsipas").
- Check `court_edge_l3_cache`; if `fetched_at < 24h ago`, reuse.
- Otherwise fetch `https://www.tennisabstract.com/cgi-bin/player.cgi?p={slug}`, parse the recent matches table, extract set scores like `6-4 7-6(5) 6-3`, sum games per match, take last 3.
- Concurrency limited to 3 in-flight at a time.
- Always returns partial results (per-player `{ok, totals?, error?}`).

### `court-edge-fetch-weather`
- Open-Meteo geocode + forecast, no key. 1h cache per city.

### `court-edge-run` (orchestrator)
1. Fetch odds, then PP — in parallel.
2. Detect tournament from event titles (lookup table from spec: Madrid, Roland Garros, Wimbledon, US Open, AO, IW, Miami, Cincy, Paris Masters/Bercy indoor, Finals indoor, etc., default = Madrid clay).
3. Fetch weather for tournament city.
4. Collect unique players → call `court-edge-scrape-l3`.
5. For each prop:
   - Compute projection via shared module.
   - `edge`, `edge_pct`, `verdict`.
6. Sort by `|edge_pct|` desc.
7. Insert into `court_edge_runs` + `court_edge_picks`.
8. Build digest text and POST to `bot-send-telegram`.

All steps wrapped in try/catch, partial failures recorded in `errors` and surfaced in the Telegram message footer.

---

## 4. Projection engine (shared)

`supabase/functions/_shared/court-edge-projection.ts`:

```text
weightedL3([m1,m2,m3])     = 0.5*m1 + 0.3*m2 + 0.2*m3
baseL3(p1Matches, p2Matches) = (weightedL3(p1) + weightedL3(p2)) / 2
surfaceMult(s)             = clay 1.08 / hard 1.00 / grass 0.92
setsMult(f)                = bo3 1.00 / bo5 1.70
spreadAdj(mlH, mlA)        = -2.5 * |normalize(mlH) - normalize(mlA)|     (vig stripped)
weatherAdj(w)              = +0.3 if F>85, -0.4 if F<50, -0.5 if wind>15, -0.2 if humidity>70 (stack)
indoorAdj(isIndoor)        = -0.5 if indoor else 0

projection = (baseL3 * surface * sets) + spreadAdj + weatherAdj + indoorAdj

edge_match  = projection - line
edge_player = projection - (line * 2)
edge_pct    = (edge / referenceLine) * 100

verdict:
  |edge_pct| >= 6  → STRONG_OVER / STRONG_UNDER
  3..6             → LEAN_OVER / LEAN_UNDER
  < 3              → PASS
```

Plus 5 unit tests in a `_test.ts` file (project rule):
1. weightedL3 with known matches → expected weighted average
2. spreadAdj symmetry: -150/+130 vs +130/-150 produce same magnitude
3. weather stacking: hot + windy + humid sums correctly
4. projection golden case: Madrid clay, Bo3, no weather → matches hand calc
5. verdict tier boundaries: 2.99/3.01/5.99/6.01 land in the right buckets

---

## 5. Telegram digest format

Reuses `bot-send-telegram` (already proven, splits long messages, hits the admin chat).

```text
🎾 COURT.EDGE — 2026-04-29 (Madrid · clay · Bo3 · outdoor · 72°F)

🟢 STRONG OVER
• Alcaraz vs Sinner — Match Total Games
  line 22.5  proj 24.10  edge +7.1%  [OddsAPI]
• Rune — Total Games Won
  line 9.5   proj 10.40  edge +9.5%  [PrizePicks]

🔴 STRONG UNDER
• Djokovic vs Wawrinka — Match Total Games
  line 21.5  proj 19.80  edge -7.9%  [OddsAPI]

🟡 LEANS (5)  ⚪ PASS (14)

Sources: Odds API ✓ · PrizePicks ✓ · TennisAbstract 11/12 · Weather ✓
Run: a3f1e2  ·  picks 22  ·  errors 1
```

A second message contains the full ranked list when it overflows. Per memory rule, no abbreviations like "TGW" — full property names.

---

## 6. Scheduling (pg_cron + pg_net)

Two daily runs in ET (project memory: standardize to ET):

```text
'court-edge-morning'   '0 13 * * *'   -- 09:00 ET (Europe slates)
'court-edge-afternoon' '0 19 * * *'   -- 15:00 ET (US/late evening)
```

Both POST to `court-edge-run` with `{source:"cron"}`.

A manual one-shot can be invoked any time via `supabase.functions.invoke("court-edge-run")`.

---

## 7. Files to create

**Edge functions:**
- `supabase/functions/court-edge-fetch-odds/index.ts`
- `supabase/functions/court-edge-fetch-prizepicks/index.ts`
- `supabase/functions/court-edge-scrape-l3/index.ts`
- `supabase/functions/court-edge-fetch-weather/index.ts`
- `supabase/functions/court-edge-run/index.ts`

**Shared:**
- `supabase/functions/_shared/court-edge-projection.ts`
- `supabase/functions/_shared/court-edge-projection_test.ts`
- `supabase/functions/_shared/court-edge-tournaments.ts`

**DB:**
- 1 migration for tables + RLS
- 1 insert-tool SQL for cron jobs (contains project URL/anon key, must not be in migrations)

**No frontend files. No route. No UI.**

---

## 8. Future grading hook (stub left in place)

`court-edge-grade-results` is not built now, but `court_edge_picks.graded/result` columns and `commence_at` are stored so a later cron can sweep finished matches, fetch final scores via The Odds API or a free results endpoint, and update W/L for ROI tracking.

---

## What I need from you before building

One ask: confirm you want me to use `add_secret` for `ODDS_API_KEY` (you'll paste your The Odds API key when prompted). After that I deploy everything and the cron will start firing the digest into your existing Telegram chat automatically.
