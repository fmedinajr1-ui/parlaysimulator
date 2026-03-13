

# Tighten Player-Prop Exposure Cap from 3 → 2

## Why (Data-Driven)
Yesterday's data shows players appearing 4x had terrible ratios (Braun 1W/3L, Jokic 1W/3L), while players at 2x had the best (Hauser 2W/0L, Scheierman 2W/0L). Reducing to 2 eliminates correlated cascade losses.

## Changes

### 1. `supabase/functions/bot-daily-diversity-rebalance/index.ts`
- Change default `maxPlayerPropUsage` from `3` to `2`

### 2. All generation engines that enforce exposure caps inline
Search for any hardcoded `max_player_prop_usage` or exposure cap references in:
- `bot-generate-daily-parlays`
- `bot-force-fresh-parlays`
- `sharp-parlay-builder`
- `heat-prop-engine`
- `bot-quality-regen-loop`
- `bot-curated-pipeline`

Update any inline cap from 3 → 2 to match the rebalance safety net.

### 3. Update memory context
Record the cap change decision with rationale so future generation logic respects it.

## Impact
- Slightly fewer total parlays (~5-10 more voided per day)
- Significantly less correlated risk — one bad leg can only sink 2 parlays max instead of 3-4
- Better ROI consistency based on yesterday's pattern

