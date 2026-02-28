

# Fix Sharp Parlay Builder and Heat Prop Engine: Zero Output Diagnosis and Threshold Lowering

## Root Cause Analysis

Today's slate has extremely thin upstream data:
- **Risk Engine**: Only **2 approved picks** (both Herb Jones -- points and rebounds)
- **Heat Tracker**: Only **2 entries** (both Herb Jones), so `buildParlays()` can't find 2 different players
- **Category Sweet Spots**: Only **9 total** for today, and only **4** pass the current fallback thresholds (`l10_hit_rate >= 0.60 AND confidence_score >= 0.65`)
- **Sharp Builder**: After archetype blocking, category-side conflicts, minutes rules, and median dead-zone filters, there aren't enough candidates from different players to form even a 2-leg SAFE parlay

Both engines fail because they require **multiple different players** but the input pool is too narrow after filtering.

## Fix Plan

### 1. Lower Sharp Builder Fallback Thresholds

**File:** `supabase/functions/sharp-parlay-builder/index.ts`

Current fallback (line ~710-711):
```
.gte("l10_hit_rate", 0.60)
.gte("confidence_score", 0.65)
```

Change to:
```
.gte("l10_hit_rate", 0.50)
.gte("confidence_score", 0.45)
```

This expands the fallback pool from 4 to all 9 sweet spots. The builder's own median/minutes/archetype rules will still filter out bad picks.

Also lower `MIN_RISK_PICKS_THRESHOLD` from 6 to **4** (line 699) so the fallback triggers earlier when the risk engine is thin.

### 2. Lower Heat Engine Fallback Thresholds

**File:** `supabase/functions/heat-prop-engine/index.ts`

Current fallback (line ~851-852):
```
.gte("confidence_score", 0.7)
```

Change to:
```
.gte("confidence_score", 0.45)
```

This lets more sweet spot picks flow into the heat tracker on thin-slate days.

### 3. Lower Heat Engine CORE/UPSIDE Score Thresholds

**File:** `supabase/functions/heat-prop-engine/index.ts`

Current thresholds (lines 1024-1031):
- CORE: `finalScore >= 78`
- UPSIDE: `finalScore >= 70`

Change to:
- CORE: `finalScore >= 70`
- UPSIDE: `finalScore >= 60`

And in `buildParlays()` (line 534):
- CORE minScore: `78` -> `70`
- UPSIDE minScore: `70` -> `60`

### 4. Lower Sharp Builder SAFE/BALANCED Confidence Thresholds

**File:** `supabase/functions/sharp-parlay-builder/index.ts`

Current PARLAY_CONFIGS thresholds (lines 213-238):
- SAFE: `confidenceThreshold: 0.7, minEdge: 12`
- BALANCED: `confidenceThreshold: 0.6, minEdge: 8`
- UPSIDE: `confidenceThreshold: 0.5, minEdge: 5`

Change to:
- SAFE: `confidenceThreshold: 0.55, minEdge: 8`
- BALANCED: `confidenceThreshold: 0.45, minEdge: 5`
- UPSIDE: `confidenceThreshold: 0.35, minEdge: 3`

### 5. Lower Sharp Builder Dream Team minEdge Thresholds

In PARLAY_CONFIGS (lines 199-214):
- DREAM_TEAM_5: `minEdge: 10` -> `minEdge: 5`
- DREAM_TEAM_3: `minEdge: 12` -> `minEdge: 8`

### 6. Lower Heat Engine Points Block for Stars

The `passesStatSafety` function (lines 246-249) hard-blocks **all** points props for star players. On thin slates this eliminates too many candidates. Change it to only log a warning instead of blocking, since the scoring system already penalizes points via `STAT_PRIORITY`.

Change the star player points check in `passesStatSafety` from `return false` to `return true` with a console warning. The `-15 baseScore` penalty in `calculateBaseRoleScore` already deprioritizes points.

## Technical Summary

| Change | File | Impact |
|--------|------|--------|
| Lower fallback thresholds | sharp-parlay-builder | Pool grows from 4 to 9 candidates |
| Lower fallback confidence | heat-prop-engine | More sweet spot picks enter tracker |
| Lower CORE/UPSIDE score gates | heat-prop-engine | More props become eligible |
| Lower SAFE/BALANCED confidence | sharp-parlay-builder | Easier to form parlays on thin slates |
| Lower Dream Team minEdge | sharp-parlay-builder | More candidates pass DT validation |
| Soften star points block | heat-prop-engine | Star points props available as last resort |

## Files Modified

1. `supabase/functions/sharp-parlay-builder/index.ts` -- Lower 5 threshold values
2. `supabase/functions/heat-prop-engine/index.ts` -- Lower 4 threshold values, soften star points block

