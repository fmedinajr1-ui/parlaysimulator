

# Data-Driven NBA Direction + L10 Minutes Cross-Reference

## What Changes

### 1. Replace Blind NBA Regression with L10/L3-Informed Direction (lines 978-986)

**New helper function `resolveNbaDirection()`** inserted before the Take It Now loop. Uses data already loaded in `playerL10` and `volatilityMap`:

```text
Decision tree:
1. Pull L10 values for this player+prop from playerL10 (already loaded at line 308)
2. Calculate L10 avg, L3 avg, L10 hit rates for OVER and UNDER vs current line

IF L10 avg > line AND OVER hit rate >= 50% → OVER ("L10 avg X clears line Y")
IF L10 avg < line AND UNDER hit rate >= 50% → UNDER ("L10 avg X below line Y")
IF player is volatile (from volatilityMap) AND L3 diverges from L10 by >15% → follow L3 direction
FALLBACK (no clear edge) → follow market direction (drift up = OVER, drift down = UNDER)
```

This replaces the current `useRegression = isNbaPlayerProp` blind logic. Snapback only happens when the DATA supports it, not as a default.

### 2. Add L10 Minutes Cross-Reference Gate

Add a minutes stability check into the Take It Now flow for NBA props. The `volatilityMap` (line 345) already has L10 minutes data. New logic:

- If player's L10 avg minutes < 20 AND prop line suggests starter-level production → **soft warn** ("⚠️ Low minutes risk — L10 avg 18min")
- If player's L10 avg minutes < 15 → **hard block** (not getting enough floor time to hit)
- If minutes CV > 30% (highly unstable) → add warning badge and reduce confidence by 10 points
- Show minutes context in the Telegram alert: `🕐 L10 Min: 32.4 avg (stable)` or `⚠️ L10 Min: 19.2 avg (VOLATILE — CV 35%)`

### 3. Update Telegram Formatting

**Direction reason text** (replaces lines 1013-1019):
- `"L10 avg 26.3 clears line 24.5 — data supports OVER"`
- `"Volatile: L3 avg 31.0 vs L10 avg 24.5 — hot streak, follow OVER"`
- `"No clear data edge — following market direction (OVER)"`

**Minutes badge** added to alert body (after volatility warning):
- `🕐 L10 Min: 32.4 avg (stable)` — for stable-minutes players
- `⚠️ L10 Min: 19.2 avg — minutes risk` — for low/volatile minutes

**Drift line** (line 1041): Change from `"historically snaps back"` to the method used (`"l10_data"`, `"l3_trend"`, or `"market_follow"`)

### 4. Update `predicted_direction` Metadata (line 1056)

Change from just `"snapback"` to the specific method: `"l10_data"`, `"l3_trend"`, or `"market_follow"` — so the accuracy feedback loop can learn which method works best.

### 5. Update `bot_owner_rules` (Migration)

Update the existing NBA direction rule to reflect the new data-driven approach:
```sql
INSERT INTO bot_owner_rules (rule_key, rule_description, rule_logic, applies_to)
VALUES ('nba_data_driven_direction', 
  'NBA player props use L10/L3 data + minutes to determine direction, not blind snapback',
  '{"logic":"l10_avg_vs_line_determines_direction","minutes_gate":"block_under_15min_warn_under_20min","volatile_follows_l3"}',
  ARRAY['fanduel-prediction-alerts'])
ON CONFLICT (rule_key) DO UPDATE SET rule_description = EXCLUDED.rule_description, rule_logic = EXCLUDED.rule_logic;
```

## Scope
- 1 edge function modified (`fanduel-prediction-alerts`)
- 1 migration (rule update)
- No new tables, no structural changes
- Uses data already loaded in the function (playerL10, volatilityMap)

