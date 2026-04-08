

# Hard Rock Bet MLB RBI Behavioral Analyzer

## Overview

Build a two-function pipeline that mirrors the existing FanDuel behavior analysis system, but targets **Hard Rock Bet MLB RBI lines** (over/under). This gives you a second bookmaker's perspective on RBI movement — useful for cross-book confirmation and catching HRB-specific sharp action.

## Architecture

```text
┌─────────────────────────┐     ┌──────────────────────────┐
│ hrb-mlb-rbi-scanner     │────▶│ hrb_rbi_line_timeline    │
│ (scrapes HRB every 5m)  │     │ (new table)              │
└─────────────────────────┘     └──────────┬───────────────┘
                                           │
                                ┌──────────▼───────────────┐
                                │ hrb-mlb-rbi-analyzer     │
                                │ (velocity, cascade,      │
                                │  snapback, correlation)  │
                                └──────────┬───────────────┘
                                           │
                                ┌──────────▼───────────────┐
                                │ fanduel_prediction_alerts │
                                │ (reuses existing table,   │
                                │  tagged bookmaker: 'hrb') │
                                └───────────────────────────┘
```

## Step 1 — New Database Table

Create `hrb_rbi_line_timeline` to store Hard Rock Bet MLB RBI snapshots:
- Columns mirror `fanduel_line_timeline`: event_id, player_name, prop_type (always `batter_rbis`), line, over_price, under_price, snapshot_phase, snapshot_time, hours_to_tip, line_change_from_open, drift_velocity, opening_line, event_description, commence_time, sport (always `MLB`)
- Partial index on recent data for fast analyzer queries
- RLS disabled (service-role only access)

## Step 2 — `hrb-mlb-rbi-scanner` Edge Function

Scrapes Hard Rock Bet MLB RBI lines from The Odds API every 5 minutes:
- Fetches `baseball_mlb` events, then per-event `batter_rbis` props filtered to `bookmakers=hardrockbet`
- Computes opening line tracking (morning_open phase), drift velocity, line change from open
- Inserts snapshots into `hrb_rbi_line_timeline`
- 30-day retention cleanup
- Uses existing `THE_ODDS_API_KEY` secret

## Step 3 — `hrb-mlb-rbi-analyzer` Edge Function

Detects behavioral patterns on HRB RBI lines, modeled after the FanDuel behavior analyzer but simplified to RBI-only:

**Pattern detection:**
1. **Line About to Move** — sustained directional drift across 3+ snapshots (consistency >= 60%)
2. **Velocity Spike** — rapid RBI line movement (adaptive thresholds from historical outcomes)
3. **Cascade** — when multiple players' RBI lines shift together (team-level signal)
4. **Snapback Candidate** — line drifted 8%+ from open, potential correction
5. **Correlated Movement** — 2+ players' RBI lines moving same direction in same game

**Output:**
- Writes alerts to `fanduel_prediction_alerts` table with `bookmaker: 'hrb'` tag to distinguish from FanDuel signals
- Includes signal metadata: velocity, direction, line_from, line_to, confidence score
- Cross-references with `mlb_player_game_logs` for L10 RBI averages to validate OVER/UNDER side
- Sends Telegram notifications for high-confidence alerts (75+)

## Step 4 — Cron Schedule

Schedule both functions:
- `hrb-mlb-rbi-scanner`: every 5 minutes during game windows
- `hrb-mlb-rbi-analyzer`: every 5 minutes, offset by 1 minute after scanner

## Technical Details

- All API calls use `bookmakers=hardrockbet` filter
- Markets param: `batter_rbis` only (focused scope)
- Time-decay weighting with 15-min half-life (same as FanDuel analyzer)
- Adaptive thresholds loaded from `fanduel_prediction_accuracy` for any existing HRB-tagged outcomes
- Deduplication: best alert per player, confidence-ranked
- Live game noise suppression inherited from FanDuel analyzer pattern

