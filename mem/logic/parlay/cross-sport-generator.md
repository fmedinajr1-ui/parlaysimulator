---
name: cross-sport-generator
description: Bulk cross-sport parlay generator pulling MLB/NHL/NBA/NCAAB/NCAAF candidates with Perplexity research boost; player-primary with team legs capped at 40%
type: feature
---

- Pipeline: `cross-sport-parlay-research` (09:30 ET, Perplexity sonar-pro per active sport)
  → `cross-sport-sweet-spots` (09:45 ET) → `cross-sport-parlay-generator` (10:00 ET).
- Leg formula: `safety = 0.45*l10_hit + 0.20*floor_margin + 0.15*median_margin
  + 0.10*line_edge + 0.10*research_boost`. Tier cuts: lock 0.80 / strong 0.70 / lean 0.60.
- Team legs use dejuiced implied prob + structural bump (HOME ML +0.04, HOME spread +0.03,
  UNDER total +0.02), capped 0.85. Team safety formula:
  `0.95*conf + 0.05 + 0.10*max(0, conf-0.50) + 0.25*research_boost` (clamped 0–1).
  Calibration: -150 ML home → ~0.67 (lean), -200 → ~0.74 (strong), -110 dog → ~0.56
  (rejected). Spreads with `|line|>=9.5` dropped. Prices worse than -250 dropped.
  All-zero L10 Unders dropped.
- Bulk mix per run: 8 × 2-leg Lock, 8 × 3-leg Strong, 6 × 4-leg Stretch, 3 × 5-leg Lottery.
- Player-primary: any ticket with `legs>=3` requires ≥1 player leg; team-market legs capped
  at 40% of the ticket; ≤1 team leg per game; ≥2 distinct games.
- Team-leg floor: `stretch_4` and `lottery_5` tickets require ≥1 team leg when the team
  candidate pool has ≥3 entries (soft floor — falls back to all-player on rare slates
  where the team pool is empty). Implemented by seeding one team leg before the greedy
  player-safety sort in `buildSlot()`.
- Pregame gating (hard): `cross-sport-sweet-spots` only ingests `unified_props` rows where
  `commence_time > now() + 15min`; generator re-checks at runtime and admin-pings if any
  stale leg slips through. Prevents live/finished-game props from entering pre-game drops.
- MLB pitcher props require confirmed starter status: player must appear in
  `mlb_pitcher_k_analysis` for today's `game_date`, else the leg is dropped (`not_starter`).
- Thin-sample cap: player legs with `<5` qualifying L10 games can never earn `lock` or
  `strong` tier — auto-downgraded to `lean` and scored from de-juiced implied prob only.
- Hard prop blacklist in `cross-sport-sweet-spots`: any player prop without a real L10
  mapper is dropped (`unmapped_prop` counter). Removed inflated approximations:
  `batter_singles` (was counted as any hit → false hits), `batter_doubles`,
  `pitcher_walks`, `pitcher_record_a_win` — none had real game-log columns.
- Over-side hitter hit-rate floor: any Over-side player leg with `l10_hit_rate < 0.55`
  is dropped (`weak_over_hit_rate`). Stops miss-by-1 leaks on lines sitting at the mean.
- Generator dedupe: `violates()` rejects any ticket with `>1 prop on the same player`
  (`multiple_props_same_player`). Prevents redundant correlated misses from stacking
  e.g. batter Hits + Total Bases + Singles all riding on one at-bat.
- Settlement: `cross-sport-parlay-settler` (cron `15 * * * *`) grades pending
  `cross_sport_*`, `ladder_challenge`, and `mega_lottery_scanner` rows in
  `bot_daily_parlays`. v2 drops the `event_id` requirement: player legs are matched
  by `(canonSport, lower(player_name), parlay_date)` against per-sport
  `*_player_game_logs`; team legs are matched by team-name substring against
  `live_game_scores` filtered to `parlay_date` (UTC window widened through the
  next day 08:00Z so ET evening games are covered). Sport + prop labels are
  normalized via `SPORT_ALIASES` / `PROP_ALIASES` (accepts both `MLB`/`baseball_mlb`
  and `RBIs`/`batter_rbis`). "No log + ingest complete" ⇒ DNP-void; "no log +
  ingest incomplete" keeps the parlay pending (no false-loss). Legs lacking any
  game context (e.g. mega_lottery team legs with no `team`/`opponent`/`game`)
  are graded as `void` with `reason: ungradable_missing_context`.
- Backfill helpers: `mlb-data-ingestion` accepts `{days_back, fetch_all:true}` to
  re-pull a date's box scores for ALL players (not just today's prop targets);
  `live_game_scores` can be upserted from ESPN scoreboard with `?dates=YYYYMMDD`.
- `mega_lottery_scanner` team legs are now gradable: `parlay-engine-v2`
  `buildExtraCandidates` drops team-market rows whose `game_description`
  doesn't parse into real teams (`extra:missing_game_context`), always
  persists `event_id` + `market_type` on every leg, and `megaLotteryScanner`
  rejects combos containing UNK / no-context team legs.
- Profitability math (BANKROLL_MATH_V1, default OFF): per-strategy ¼-Kelly
  staking with Bayesian-smoothed hit rate vs leg-count priors. Settler
  refreshes `strategy_pnl_rolling` (7d + 30d windows) after each grading run;
  generators read window=7d to (1) suppress strategies whose `rolling_ev_per_unit
  < 0` after ≥5 graded samples, (2) require combined decimal odds ≥ `1/p̂ ×
  1.10`, (3) cap Σstake at 20 % of bankroll per day. See
  `mem://logic/betting/profitability-math`.
- Learning: each graded leg is appended to `cross_sport_leg_feedback` with
  sport/prop_type/side/tier/safety/l10_hit/result/actual so we can aggregate which
  prop types leak. Service-role-only (deny-all SELECT policy).
- Persists into `cross_sport_sweet_spots` and `bot_daily_parlays` (strategy_name
  `cross_sport_<slot>`); broadcasts top 5 via `bot-send-telegram` type
  `cross_sport_parlay`.
*** End Patch