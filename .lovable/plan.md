## Test Run: Cross-Sport Parlay Pipeline

Trigger the three functions in order and verify every leg has a real, live line before any broadcast goes out.

### Steps

1. **Research** — `POST /cross-sport-parlay-research` (all in-season sports). Confirm rows land in `bot_research_findings` for today (ET).
2. **Sweet Spots** — `POST /cross-sport-sweet-spots`. Then run a verification query against `cross_sport_sweet_spots` for `analysis_date = today`:
   - `recommended_line IS NOT NULL` for every player + spread + total leg
   - `price BETWEEN -250 AND +400`
   - `event_id` joins to a live `unified_props` / `bot_odds_snapshot` row updated within the last 6 hours
   - Drop counts logged per sport (fat-spread, juice, all-zero-under)
3. **Generator (dry run first)** — `POST /cross-sport-parlay-generator?dry=1`. Verify:
   - 25 tickets built across the 8/8/6/3 slot mix
   - Every leg's `price` + `recommended_line` matches the sweet-spot row it came from (no synthetic lines)
   - Diversity gates pass (≥2 games, ≤1 team leg/game, ≥1 player leg when legs≥3, team ≤40%)
4. **Live run** — only if dry-run is clean: `POST /cross-sport-parlay-generator` (no `dry`). Persists to `bot_daily_parlays` and broadcasts top 5 via `bot-send-telegram` (`type: cross_sport_parlay`).
5. **Post-broadcast spot check** — pull the 5 broadcast tickets back from `bot_daily_parlays`, re-resolve each leg's line against the latest FanDuel snapshot, and flag any mismatch >0.5 line units or >15¢ price drift.

### Abort conditions

- Empty research pool for any active sport → admin-only Telegram alert, stop.
- Sweet-spot table has 0 active rows for today → stop, do not run generator.
- Any leg fails the live-line join in step 2 → drop that leg, re-run sweet-spots, do not proceed to generator until clean.
- Dry-run shows <15 tickets or any diversity violation → stop, report which slot starved.

### Deliverable

A single status report back in chat:
- counts per stage (research rows, sweet-spot legs by sport, tickets by slot)
- list of any legs dropped for stale/missing lines
- confirmation the top-5 broadcast went out (or the reason it didn't)

No code changes — this is execution + verification only.