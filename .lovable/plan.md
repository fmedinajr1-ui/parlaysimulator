# Active Plans & Recent Changes

See `.lovable/archive/` for completed features prior to March 9, 2026.

# Universal Recency Decline Flag (L3 Gate) — IMPLEMENTED ✅ (March 9, 2026)

## Problem
Picks like Naji Marshall Over 14.5 PTS passed filters because L10 avg (17.0) cleared the line, but his last 4 games were 8, 13, 6, 4.

## Solution
Added `l3_avg` column + universal recency decline filter across ALL engines.

### Thresholds
- **HARD BLOCK (OVER)**: `l3_avg < l10_avg * 0.75` (25%+ decline)
- **HARD BLOCK (UNDER)**: `l3_avg > l10_avg * 1.25` (25%+ surge)
- **WARNING FLAG**: `l3_avg < l10_avg * 0.85` (15%+ decline, shown in broadcasts as 📉)

# NHL Matchup Intelligence Filter — IMPLEMENTED ✅ (March 11, 2026)

## Problem
NHL prop scanner fetched `nhl_team_defense_rankings` but **hardcoded matchupAdjustment to 0**. Floor lock picked purely on L10 hit rate — ignoring whether the player faces the league's best or worst defense.

## Solution
Wired prop-specific defensive/offensive matchup scoring into the scanner and floor lock orchestrator.

# Prop Type Normalization — IMPLEMENTED ✅ (March 11, 2026)

## Problem
`bot_player_performance` stored `threes` and `player_threes` as separate records, causing split "serial loser" / "proven winner" tracking.

## Solution
Added `normalizePropType()` to settlement, hit-rate rebuild, and parlay generation. Ran one-time SQL merge of existing split records.

# Streak Penalty in Weight Calibration — IMPLEMENTED ✅ (March 11, 2026)

## Problem
`calculateWeight()` ignored `current_streak`. Categories like `THREE_POINT_SHOOTER` kept weight 1.30 during a -12 cold streak.

## Solution
Added `calculateStreakPenalty()` to `calibrate-bot-weights`:
- Streak ≤ -3: penalty = streak × 0.02
- Streak ≤ -8: penalty = streak × 0.03
- Streak ≤ -15: auto-block regardless of hit rate
- Example: -12 streak → -0.36 penalty, weight drops from ~1.22 to ~0.86

# Admin Bankroll Sync & Telegram Cleanup — IMPLEMENTED ✅ (March 11, 2026)

## Problem
1. Admin's `bot_authorized_users.bankroll` stuck at $9,041 while authoritative `simulated_bankroll` was $67,861
2. Telegram spammed admin with raw JSON dumps for `custom` type and noisy internal types

## Solution
- **Settlement sync**: After `bot_activation_status` upsert, admin's `bot_authorized_users.bankroll` now syncs to `finalBankroll`
- **Telegram cleanup**: Suppressed `weight_change`, `quality_regen_report`, `hit_rate_evaluation`; clean `doctor_report` (0 problems) silenced; `custom` type extracts `data.message` cleanly; default case no longer dumps raw JSON

# Mispriced Lines Intelligence Tightening — IMPLEMENTED ✅ (March 12, 2026)

## Problem
`detect-mispriced-lines` scored edges purely on L10/L20 averages vs book line, ignoring player consistency, historical hit rates, minutes volatility, cross-book consensus, and its own track record.

## Solution
Added 5 intelligence upgrades to the existing engine:

1. **Variance/Consistency Filter**: CV (stdDev/mean) dampens edge 20-40% for volatile players (CV > 0.35)
2. **Historical Hit-Rate Cross-Ref**: Cross-references `category_sweet_spots` L10 hit rate — dampens edge 30% if hit rate < 60%
3. **Minutes Stability Check** (NBA only): Compares L3 vs L10 avg minutes — dampens edge 25% if ratio < 0.80
4. **Cross-Book Consensus**: Calculates median line across all bookmakers — boosts edge 15% when a single book deviates > 5% from consensus
5. **Outcome Feedback Loop**: Last 14 days of settled mispriced_lines accuracy → applies 0.8x-1.2x multiplier per prop type

All fields persisted to `shooting_context` for transparency: `variance_cv`, `historical_hit_rate`, `minutes_stability`, `consensus_line`, `consensus_deviation_pct`, `feedback_accuracy`, `feedback_multiplier`.

# Scanlines Line-Movement Tracking & Whale Verdicts — IMPLEMENTED ✅ (March 13, 2026)

## Problem
`detect-mispriced-lines` ran daily but **overwrote** results each scan — no history of how lines moved throughout the day. Couldn't detect whale activity (e.g., +100 → -150 = sharp money).

## Solution
Built a time-series snapshot + pre-game verdict system:

### New Tables
- **`mispriced_line_snapshots`**: Every scan inserts timestamped rows (never overwrites). Stores player, prop, line, edge, confidence, shooting_context.
- **`mispriced_line_verdicts`**: Pre-game final assessment comparing first vs last snapshot. Stores line_movement, whale_signal (STEAM/FREEZE/NONE), verdict (SHARP_CONFIRMED/TRAP/HOLD).

### Updated `detect-mispriced-lines`
- After existing upsert to `mispriced_lines`, now **also inserts** all results (mispriced + correct-priced) into `mispriced_line_snapshots` with timestamp.

### New Edge Function: `finalize-mispriced-verdicts`
- Compares earliest vs latest snapshots for each player-prop
- Line moved in favor + edge strengthened → **SHARP_CONFIRMED** (whale money)
- Line moved against ≥1pt → **TRAP** (market faded)
- Minimal movement → **HOLD**
- Sends Telegram alert with actionable verdicts

### Cron Schedule (3 daily scans + 1 verdict)
- **10:00 AM ET** — existing morning scan (via `refresh-l10-and-rebuild`)
- **12:30 PM ET** — midday re-scan
- **3:00 PM ET** — pre-tip re-scan
- **5:30 PM ET** — `finalize-mispriced-verdicts` (whale verdict before 7pm games)

### Telegram `/scanlines` Enhancement
- Shows snapshot movement trail: `10:00am: 24.5 → 12:30pm: 23.5 → 3:00pm: 22.5`
- Displays whale verdict inline: `🐋 SHARP_CONFIRMED — Line moved 2.0 pts in favor`

# Bidirectional Scanner Dedup + L3 Filter + /legresults — IMPLEMENTED ✅ (March 13, 2026)

## Problems Fixed
1. **Duplicate Leg Bug**: `strongUnders` could contain same player multiple times → deduped by `player_name::prop_type` keeping highest L10 hit rate, plus same-player guard in parlay assembly
2. **L3 Contradiction**: Players like Desmond Bane recommended UNDER despite L3 avg being 10%+ above line → added L3 contradiction filter in `bot-matchup-defense-scanner` that skips players whose L3 strongly contradicts the recommended side
3. **Individual Leg Visibility**: Added `/legresults` Telegram command showing per-leg wins/losses with actual values for any date

# Scanlines v2: FanDuel Game Markets + Pre-Game Alerts — IMPLEMENTED ✅ (March 13, 2026)

## Problem
Scanlines only analyzed player props. No FanDuel-specific game market scanning (moneylines/totals), no line drift tracking, and no timed pre-game alerts.

## Solution
Built a 3-layer game market intelligence system:

### New Table: `game_market_snapshots`
Stores timestamped FanDuel lines for drift tracking with `drift_amount`, `drift_direction`, and `alert_sent` dedup flag.

### New Edge Function: `scanlines-game-markets`
- Scans FanDuel moneylines + totals from `game_bets`
- Inserts timestamped snapshots for drift calculation
- Cross-refs KenPom data for NCAAB (projected totals from AdjO/AdjD/tempo)
- Cross-refs `whale_picks` for convergence detection
- Scores markets: base edge + drift magnitude (1.15x boost) + whale convergence (1.2x boost)
- Stores top signals to `mispriced_lines` with `prop_type = 'game_total'` or `'game_moneyline'`

### New Edge Function: `pregame-scanlines-alert`
- Runs every 15 minutes via cron
- Finds games starting in 25-45 minute window
- Sends Telegram alerts for games with edge ≥ 5%, whale convergence, or dramatic drift (≥1.5pts totals, ≥15 odds moneylines)
- Dedup via `alert_sent` flag on snapshots

### Updated `/scanlines` Telegram Handler
- Now triggers both `detect-mispriced-lines` AND `scanlines-game-markets` in parallel
- Shows "GAME MARKETS (FanDuel)" section first with drift trails, KenPom context, whale tags
- Player props section follows below
- Grouped by sport with emoji labels

### Cron Schedule
- **10:00 AM ET**: `scanlines-game-markets` (morning scan)
- **12:30 PM ET**: `scanlines-game-markets` (midday scan)
- **3:00 PM ET**: `scanlines-game-markets` (pre-tip scan)
- **Every 15 min**: `pregame-scanlines-alert` (pre-game alerts ~30 min before tip)

### Sports Coverage
| Sport | Moneyline | Totals | KenPom/Data | Whale Drift | Pre-Game Alert |
|-------|-----------|--------|-------------|-------------|----------------|
| NCAAB | ✅ | ✅ | KenPom + ATS | ✅ | ✅ |
| NBA | ✅ | ✅ | Composite | ✅ | ✅ |
| NHL | ✅ | ✅ | — | ✅ | ✅ |
| MLB | ✅ | ✅ | — | ✅ | ✅ |
