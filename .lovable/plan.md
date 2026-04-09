

# Track RBI Pick Accuracy and Build RBI Parlays

## The Problem
You have **994 RBI alerts** (`batter_rbis`) in the system — all unsettled. The current feedback loop uses Closing Line Value (CLV) which doesn't work for RBI picks because the line is always 0.5 and doesn't move meaningfully. We need **outcome-based settlement**: did the batter actually get 1+ RBI in the game?

## What We'll Build

### Phase 1: RBI Settlement Engine (new edge function)
**`mlb-rbi-settler`** — settles RBI picks using actual game log data.

- Queries unsettled `batter_rbis` alerts from `fanduel_prediction_alerts`
- Cross-references against `mlb_player_game_logs` (which has actual RBI counts per game)
- Settlement logic:
  - **Over 0.5 RBI** prediction → correct if player had **1+ RBI** in that game
  - **Under 0.5 RBI** prediction → correct if player had **0 RBI** in that game
- Fuzzy name matching (same as existing feedback loop)
- Updates `was_correct`, `actual_outcome`, and `settled_at` on each alert
- Runs as part of the morning prep pipeline (after games complete)

### Phase 2: RBI Accuracy Dashboard Query
**New RPC function `get_rbi_accuracy_dashboard`** — aggregates settled RBI picks into useful breakdowns:

- **Overall**: total picks, win rate, by Over vs Under
- **By Signal Type**: cascade vs snapback vs velocity_spike vs price_drift — which signal types actually predict RBI outcomes?
- **By L10 Hit Rate Bucket**: do 0-RBI-in-L10 players actually stay under? (validates the Under 0 RBI thesis)
- **By Confidence Level**: do higher-confidence alerts hit more?
- **By Pitcher ERA Bucket**: do high-ERA pitchers correlate with more RBI overs?

### Phase 3: RBI Parlay Generator
**`generate-rbi-parlays`** — builds 2-3 leg RBI parlays from the highest-accuracy signal clusters.

- Only uses signal types with **60%+ historical accuracy** (from Phase 2 data)
- Pairs Under 0.5 RBI legs (cold batters vs high-K pitchers) with Over 0.5 RBI legs (hot batters vs high-ERA pitchers)
- Cross-references L10 data and pitcher matchup from `mlb_rbi_under_analysis`
- Sends formatted parlay suggestions to Telegram with accuracy stats per leg
- Integrated into morning prep pipeline

### Phase 4: Add to Morning Pipeline
Wire `mlb-rbi-settler` into the morning prep pipeline as a new step (runs after game logs are backfilled so outcomes are available).

## Migration
- Add index on `fanduel_prediction_alerts` for `(prop_type, was_correct, settled_at)` to speed up RBI settlement queries

## Files Changed
1. **New:** `supabase/functions/mlb-rbi-settler/index.ts`
2. **New:** `supabase/functions/generate-rbi-parlays/index.ts`
3. **Migration:** New index + RPC function `get_rbi_accuracy_dashboard`
4. **Edit:** `supabase/functions/morning-prep-pipeline/index.ts` — add settler + parlay steps

