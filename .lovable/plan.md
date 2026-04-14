

# Over SB & Over HR Tracking + Smarter Models

## Current State
- **SB**: Basic L10 model (avg >= 0.5, hit rate >= 50%). No Over picks settled yet. Still 274 stale Under SB records in DB.
- **HR**: 4-factor model exists but caps probability at 22% — making Overs nearly impossible to flag (2 Over picks in 2 weeks vs 192 Unders).

## Changes

### 1. Clean up stale Under SB records
Delete the 274 `sb_under_l10` alerts from `fanduel_prediction_alerts` that were created before the block was added. One-time cleanup via migration.

### 2. Upgrade `mlb-sb-analyzer` — Smarter Over SB Model
Replace the basic L10-only model with a multi-factor approach:

- **Catcher factor**: Look up the opposing catcher's caught-stealing rate from game logs. Weak catchers (low CS%) = higher SB probability.
- **Pitcher factor**: Pitchers who allow high SB counts (check opposing pitcher's games for SB allowed). Slow delivery pitchers = more steal opportunities.
- **Batting order position**: Leadoff/2-hole hitters get more opportunities.
- **L5 trend weighting**: Weight recent 5 games heavier than L10 (60/40 blend) to catch hot streaks.
- **Game context from line**: If the game total is high (lots of baserunners expected), SB opportunities increase.
- **Tiered confidence scoring**:
  - ELITE: L10 avg >= 0.8, Over rate >= 70%, facing weak catcher
  - HIGH: L10 avg >= 0.6, Over rate >= 60%
  - MEDIUM: L10 avg >= 0.5, Over rate >= 50% (current threshold)

### 3. Upgrade `first-inning-hr-scanner` — Unlock Over HR Picks
The model is good but Over picks are suppressed by two config issues:

- **Raise probability cap** from 0.22 to 0.35 — elite sluggers facing hittable pitchers in HR-friendly parks can legitimately exceed 22% HR probability.
- **Lower Over-specific edge threshold** to 3% (keep Under at 5%) — HR Overs are inherently lower probability but higher value.
- **Add "power hitter" boost**: Players with L20 HR rate >= 0.20 (1 HR per 5 games) get a 1.15x multiplier.
- **Add "pitcher HR vulnerability" boost**: Pitchers with HR/9 >= 1.5 AND "hittable" recent form get a 1.10x multiplier.

### 4. Create `mlb-over-tracker` — Unified Over Performance Dashboard
New edge function that:

- Queries all Over SB and Over HR picks from `fanduel_prediction_alerts` and `category_sweet_spots`
- Settles them against `mlb_player_game_logs`
- Tracks win rate by: player, confidence tier, model factors used
- Sends daily Telegram report: "📊 Over Tracker: SB 8/12 (67%) | HR 3/10 (30%)"
- Identifies which factors correlate with wins (e.g., "weak catcher SB picks: 80% hit rate" vs "strong catcher: 45%")

### 5. Generate Over HR + Over SB parlays
Add Over HR and Over SB as eligible categories in `l3-cross-engine-parlay`:

- Allow MLB_HR_OVER sweet spots as parlay legs
- Allow `sb_over_l10` alerts as parlay legs
- Build 2-3 leg "Power + Speed" parlays mixing HR Over and SB Over picks
- Require minimum confidence tier of HIGH for parlay inclusion

## Files
- `supabase/functions/mlb-sb-analyzer/index.ts` — multi-factor upgrade
- `supabase/functions/first-inning-hr-scanner/index.ts` — unlock Over HR picks
- `supabase/functions/mlb-over-tracker/index.ts` — new tracking + settlement function
- `supabase/functions/l3-cross-engine-parlay/index.ts` — add Over HR/SB to parlay pool
- One-time DB cleanup of stale Under SB records

## No new tables needed
Uses existing `fanduel_prediction_alerts`, `category_sweet_spots`, and `mlb_player_game_logs`.

