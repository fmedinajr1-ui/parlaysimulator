

# Nuke All Under Stolen Bases from Every System

## Problem
Under SB picks keep appearing in parlays (see Parlay #3 in your screenshot). Three leak sources:

1. **`mlb-batter-analyzer`** — generic analyzer treats `batter_stolen_bases` like any other prop and generates UNDER signals into `mispriced_lines`
2. **`l3-cross-engine-parlay`** — blocks Under SB from **sweet spots** (line 170) but NOT from **mispriced lines** (line 139-163), so mispriced Under SB leaks through
3. **`fanduel-prediction-alerts`** — has a block at Telegram level but old `sb_under_l10` records already exist in the database and can be picked up by parlay engines

## Fix (3 files)

### 1. `mlb-batter-analyzer/index.ts` — Block at source
Add a skip for `batter_stolen_bases` UNDER before pushing to results (around line 165):
```typescript
// Block UNDER stolen bases — Over-only market
if ((prop.stat_type === 'batter_stolen_bases' || prop.stat_type === 'stolen_bases') && signal === 'UNDER') {
  continue;
}
```

### 2. `l3-cross-engine-parlay/index.ts` — Block in mispriced section
Add the same Under SB block in the mispriced loop (lines 139-163), not just the sweet spot loop:
```typescript
// Inside the mispriced loop, before pickMap.set:
if ((normalizedProp === 'stolen_bases' || normalizedProp === 'stolen bases') && m.signal.toLowerCase() === 'under') {
  console.log(`[L3CrossEngine] Blocked UNDER SB (mispriced): ${m.player_name}`);
  continue;
}
```

### 3. `fanduel-prediction-alerts/index.ts` — Already has blocks (no change needed)
The existing blocks at lines 1282-1284 and 1311-1313 are correct. No change needed here.

### Summary
- Stop creating Under SB at the source (batter analyzer)
- Block the mispriced path in L3 engine (was only blocking sweet spot path)
- No DB changes needed — old records won't be picked up once both paths are blocked

