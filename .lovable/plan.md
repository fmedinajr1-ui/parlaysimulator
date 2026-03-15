

# Unify Hedge Status Labels: Consolidate "ON TRACK" → "HOLD"

## Current State

The same engine status `on_track` shows different labels depending on context:
- **CustomerHedgeIndicator**: "ON TRACK" 
- **ScoutHedgePanel**: "ON TRACK"
- **PropHedgeIndicator / HedgeModeTable**: "HOLD"
- **HedgeRecommendation**: "✓ ON TRACK"
- **HedgeStatusAccuracyCard**: "On Track"

The action-label system in `hedgeStatusUtils.ts` already maps `on_track` → `HOLD`. The unified 5-tier vocabulary should be: **LOCK, HOLD, MONITOR, HEDGE ALERT, HEDGE NOW**.

## Changes

### 1. `CustomerHedgeIndicator.tsx`
- Change `on_track` tier label from `'ON TRACK'` → `'HOLD'`
- Change message from `'Looking good'` → `'On pace — no action needed'`

### 2. `ScoutHedgePanel.tsx`  
- Change `on_track` label from `'ON TRACK'` → `'HOLD'`

### 3. `HedgeRecommendation.tsx`
- Change headline from `'✓ ON TRACK'` → `'✓ HOLD'`

### 4. `HedgeStatusAccuracyCard.tsx`
- Change label from `'On Track'` → `'Hold'`

### 5. `CustomerHedgePanel.tsx`
- Update `TIER_LABELS.on_track.label` from `'ON TRACK'` → `'HOLD'`

No logic changes — only display labels. The internal `on_track` engine status and `HedgeActionLabel` type remain unchanged.

