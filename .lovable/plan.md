

# Exposure Cap, Bench Thresholds & Over/Under Intelligence Fix

I've verified all the exact line numbers. Here's what will change:

## 1. `bot-quality-regen-loop/index.ts`
- **Line 262-263**: `EXPOSURE_CAP = 1` → `3`, `EXPOSURE_CAP_DOUBLE_CONFIRMED = 2` → `4`
- **Line 344**: Bench confidence `> 0.4` → `> 0.25`
- **Line 405-406**: `DAILY_PARLAY_CAP = 15` → `20`

## 2. `bot-daily-diversity-rebalance/index.ts`
- **Line 88**: `max_player_prop_usage` default `2` → `3`
- **Line 266**: Bench confidence `> 0.4` → `> 0.25`

## 3. `category-props-analyzer/index.ts` (lines 1308-1335)
- Sample threshold: `>= 10` → `>= 7`
- Flip gap: `< 0.45` / `> 0.55` → `< 0.48` / `> 0.52`
- Add new rule: if either side has `>= 0.60` hit rate with 7+ samples, force that side regardless of the other side's rate

## Post-Deploy
- Deploy all 3 edge functions
- Invoke `refresh-l10-and-rebuild` to trigger a full generation cycle with the new settings

