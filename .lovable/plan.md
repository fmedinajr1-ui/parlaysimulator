## Goal

Right now `parlay-engine-v2`, `nuke-build-parlays`, and the Telegram parlay scanner only build legs from **player props** (and almost entirely NBA shapes — Points, Rebounds, Assists, Threes, etc.). Everything in `unified_props` is shaped like a player O/U, and team markets (`team_moneyline_odds`) are fetched but never read by the generators. MLB coverage is limited to whatever `pp_snapshot` mirrors (a handful of stat types).

We'll open two doors:

1. **Team markets as parlay legs** — moneyline (H2H), spread, total (O/U) for every sport we already pull.
2. **Broader MLB prop catalog** — pull every player market The Odds API exposes for MLB and route it through the same unified pipeline.

Basketball stays as-is; this is purely additive.

---

## Phase 1 — Team markets in unified_props

Right now `unified_props.prop_type` is always a player stat. We'll allow team-market rows:

- New canonical prop_types: `Moneyline`, `Spread`, `Total`
- `player_name` repurposed as the **team** for ML/Spread, and `"Game Total"` for Totals
- `current_line` = spread number / total number (0 for moneyline)
- `over_price`/`under_price`:
  - Moneyline → home_odds in `over_price`, away_odds in `under_price` (with `recommended_side` = HOME/AWAY)
  - Spread → over=favored side, under=dog
  - Total → over/under as usual

New sync function `team-markets-sync` (runs alongside `mlb-props-sync`):

- Reads The Odds API `markets=h2h,spreads,totals` for `basketball_nba`, `baseball_mlb`, `icehockey_nhl`, `americanfootball_nfl` (whichever are in season — derive from existing fetchers).
- Writes one row per (event, market, bookmaker) into `unified_props` with `category='team_market'`.
- Also keeps writing the existing `team_moneyline_odds` rows for backward compat.

## Phase 2 — Expand MLB player prop catalog

Today `mlb-props-sync` only mirrors `pp_snapshot` (PrizePicks). Add direct Odds API ingestion for MLB markets:

Pitcher: `pitcher_strikeouts`, `pitcher_outs`, `pitcher_hits_allowed`, `pitcher_walks`, `pitcher_earned_runs`, `pitcher_record_a_win`
Batter: `batter_hits`, `batter_total_bases`, `batter_home_runs`, `batter_rbis`, `batter_runs_scored`, `batter_stolen_bases`, `batter_singles`, `batter_doubles`, `batter_walks`, `batter_strikeouts`, `batter_hits_runs_rbis`

New function `mlb-odds-props-sync` (or extend `mlb-props-sync`):
- Loops today's MLB events from existing event fetcher
- Pulls all the above markets per event from preferred books (HardRock → FanDuel → DraftKings)
- Upserts into `unified_props` with canonical prop_type labels (see Phase 3)
- Keeps the PrizePicks pp_snapshot mirror as a secondary source

## Phase 3 — Engine config: whitelist + canonical labels

Edit `supabase/functions/_shared/parlay-engine-v2/config.ts`:

- Extend `PROP_TYPE_CANONICAL` in `parlay-engine-v2/index.ts` with MLB + team-market keys:
  - `pitcher_strikeouts → Pitcher Ks`, `batter_total_bases → Total Bases`, `batter_home_runs → Home Runs`, `batter_hits → Hits`, `batter_rbis → RBIs`, `batter_runs_scored → Runs`, `batter_stolen_bases → Stolen Bases`, etc.
  - `h2h → Moneyline`, `spreads → Spread`, `totals → Total`
- Add new whitelist entries with conservative starting weights (we'll calibrate after a week of data):
  - MLB: `Pitcher Ks|OVER 0.62`, `Home Runs|OVER 0.55`, `Total Bases|OVER 0.58`, `RBIs|UNDER 0.55`, `Hits|OVER 0.56`, `Stolen Bases|OVER 0.55`
  - Team: `Moneyline|HOME 0.58`, `Spread|OVER 0.55`, `Total|UNDER 0.56`, `Total|OVER 0.55`
- Add new signal sources: `MLB_BATTER_HR`, `MLB_BATTER_TB`, `MLB_PITCHER_K_OVER` (already exists in watchlist), `TEAM_ML_FAV`, `TEAM_SPREAD_DOG`, `GAME_TOTAL_OVER`, `GAME_TOTAL_UNDER` — placed in `SIGNAL_TIER_B` / `SIGNAL_WATCHLIST` until we have hit-rate data.
- Update `inferSport()` in `parlay-engine-v2/index.ts` to detect team-market rows and the new MLB types.
- Loosen the `parseTeams` path so Moneyline/Spread/Total legs don't require a player_name match — they carry team in `player_name` and skip the player-active gate.

## Phase 4 — Telegram scanner + nuke builder

- `telegram-prop-scanner` and `nuke-build-parlays` already iterate `unified_props`; they'll inherit new prop types automatically once Phase 3 canonicalization lands.
- Update message formatter so team-market legs render as `"DAL Moneyline -150"` / `"DAL/BOS Total OVER 224.5"` instead of trying to print a player name + stat.
- Add a per-leg type to the Telegram label so the user sees a `🏀 PLAYER` / `⚾ PITCHER` / `📈 TEAM` chip.

## Phase 5 — Database migration

New migration:
- Add `unified_props.market_type text not null default 'player'` (values: `player`, `moneyline`, `spread`, `total`).
- Add partial index `(sport, market_type, commence_time)` for fast engine reads.
- No data backfill needed (table is empty today).

## Out of scope (for this pass)

- Calibrating new whitelist weights against historical results (waits until we accumulate ~2 weeks of settled data).
- HRB/RBI-specific analyzer rewrites — they keep reading their existing tables.
- NHL/NFL prop catalog expansion beyond team markets — covered in Phase 1 but no player props added here.

## Files touched

```
supabase/functions/team-markets-sync/index.ts                 (new)
supabase/functions/mlb-odds-props-sync/index.ts               (new)
supabase/functions/_shared/parlay-engine-v2/config.ts         (whitelist, signal tiers)
supabase/functions/parlay-engine-v2/index.ts                  (canonical map, team-leg path)
supabase/functions/telegram-prop-scanner/index.ts             (leg formatter)
supabase/functions/nuke-build-parlays/index.ts                (leg formatter)
supabase/migrations/<ts>_unified_props_market_type.sql        (new)
```

Want me to ship all 5 phases together, or start with Phase 1 + 5 (team markets + migration) so you can see ML/Spread/Total legs flowing first, then layer MLB props on top?