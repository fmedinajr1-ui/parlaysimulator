## WNBA Backtest Backfill — Plan

Goal: populate `fanduel_prediction_accuracy` with WNBA rows tagged `settlement_method='backtest'` so the n>=50 / 52.4% gate (the one currently blocking `take_it_now`, and by extension every other prop signal) has real evidence to evaluate before any live game is played.

### What gets built

**1. Schema additions (one migration)**
- New table `wnba_player_game_logs` — per-player per-game box score (pts, reb, ast, stl, blk, threes, fta, ftm, fga, fgm, min, opponent_team, game_date_et). Source of truth for grading.
- New table `wnba_historical_odds_snapshots` — one row per (event_id, market, player, line, side, price, snapshot_ts). Source of truth for "what was the line/price at decision time."
- Add columns to `fanduel_prediction_accuracy`: nothing structural needed — we re-use `settlement_method` ('backtest' vs 'live'), `is_gated`, and `signal_factors` (we tag `{ backfill: true, season: '2024' }`).

**2. Three edge functions**

| Function | Job | Source |
|---|---|---|
| `wnba-backfill-box-scores` | Pull every 2024 + 2025 WNBA regular-season + playoff game, write per-player rows | ESPN public scoreboard + boxscore endpoints (free, rate-limit ~1 req/sec) |
| `wnba-backfill-odds` | For each game, pull historical odds snapshots (H2H, totals, spreads, player_points, player_rebounds, player_assists, player_threes, player_points_rebounds_assists) at T-24h, T-2h, T-30min | The Odds API `historical` endpoint (`THE_ODDS_API_KEY`) — counts against credit budget |
| `wnba-backtest-signals` | Replay `signal-alert-engine` and `parlay-engine-v2` decision logic against each (snapshot, prop) pair. Compare to actual outcome from box scores. Write graded rows to `fanduel_prediction_accuracy`. | Internal — no API cost |

**3. Gate handling**
- Modify the gate's `loadTakeItNowPropStats()` (and any other signal gate that queries `fanduel_prediction_accuracy`) to **count backtest rows toward sample floor but weight them at 0.7** when computing hit rate. This prevents a perfect backtest from looking like 100% live truth, but still lets gates unlock.
- Add a `WNBA_BACKTEST_DECAY_DAYS=30` knob — backtest rows older than 30 days from go-live get their weight reduced further (toward 0.4) so live data dominates as it accumulates.

**4. Orchestration**
- Run the three functions in sequence as a one-shot: box scores -> odds snapshots -> signal replay. No cron — manual trigger from a small admin button or single curl.
- Each function is idempotent (upsert on natural keys) so reruns are safe.

### Cost / data realism check (read this)

- **ESPN box scores**: free, ~250 WNBA regular-season + ~40 playoff games per season. ~10 min total wall time.
- **The Odds API historical**: this is the cost driver. Their historical endpoint charges **10 credits per request per market per snapshot**. To do 2 seasons (~600 games) x 8 markets x 3 snapshots = ~14,400 requests = **~144,000 credits**. Confirm your plan allows that before I run odds backfill. If budget is tight, options:
  - Cut to 2025 only (~half cost)
  - Cut to 1 snapshot per game at T-2h (~third cost)
  - Cut player-prop markets to just the 3 most common (points, rebounds, assists) (~37% cost)
- **Backtest replay**: free, compute-only.

### Honest caveat (this is why I pushed back earlier)
Backtest hit rates measure "what the engine *would* have done given the line that *did* exist," but real `take_it_now` triggers off live FanDuel velocity / juice gap snapshots that aren't in The Odds API history. Three of the four sub-signals inside `take_it_now` (juice gap, velocity spike, pre-tip drift) can be reconstructed from the 3-snapshot pull; the live-line and post-alert-monitor pieces cannot. Expect the backtest to be **structurally weaker than live** — that's why backtest rows get the 0.7 weight.

### Technical details

- `wnba-backfill-box-scores`: iterates `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=YYYYMMDD` for each day in season window, then `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event={id}` for each game. Maps ESPN athlete_id -> player name; upserts `wnba_player_game_logs` on `(player_name, game_date_et, opponent_team)`.
- `wnba-backfill-odds`: for each game, calls `https://api.the-odds-api.com/v4/historical/sports/basketball_wnba/events/{event_id}/odds?date={iso}&markets={...}&regions=us&bookmakers=fanduel`. Three calls per game at game_start - 24h, -2h, -30m. Upserts on `(event_id, market, player_name, line, side, snapshot_ts)`.
- `wnba-backtest-signals`: pseudocode
  ```
  for each (event, prop, snapshot_t-2h):
    derive juice_gap = abs(americanToProb(over) - americanToProb(under))
    if juice_gap >= 0.18 and prop_type in ALLOWED:
      prediction = side_with_higher_implied_prob_INVERTED  // take_it_now fades the favorite
      actual = box_score_lookup(player, prop_type, game_date)
      hit = compare(actual, line, prediction)
      insert fanduel_prediction_accuracy(signal_type='take_it_now', sport='wnba',
        prop_type, player_name, event_id, prediction, was_correct=hit,
        edge_at_signal=juice_gap, settlement_method='backtest',
        signal_factors={backfill:true, season, snapshot:'t-2h'},
        verified_at=game_end_ts)
  ```
- Gate edit in `signal-alert-engine/index.ts`: in `loadTakeItNowPropStats`, when summing hits/totals, multiply backtest-row contributions by 0.7. Add the same scaling to any analogous gate loaders we add later for other signals.

### Files touched
- new: `supabase/migrations/<ts>_wnba_backfill_tables.sql`
- new: `supabase/functions/wnba-backfill-box-scores/index.ts`
- new: `supabase/functions/wnba-backfill-odds/index.ts`
- new: `supabase/functions/wnba-backtest-signals/index.ts`
- edit: `supabase/functions/signal-alert-engine/index.ts` (weighted backtest counting)
- new: `mem/logic/betting/wnba-backtest-weighting.md`
- edit: `mem/index.md`

### Open questions before I build
1. **Budget**: confirm The Odds API plan can absorb ~150k historical credits, or pick a reduced scope (2025-only / 1-snapshot / 3-markets).
2. **Signal coverage**: just `take_it_now`, or also `velocity_spike`, `model_edge`, `live_line_about_to_move`? Each additional signal is a separate replay pass over the same odds data (cheap once odds are pulled).
3. **Weight**: 0.7 backtest weight is my recommendation. You can override (1.0 = treat as fully live, 0.5 = backtest counts as half).
