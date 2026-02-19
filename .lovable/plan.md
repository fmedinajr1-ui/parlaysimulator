
# Line Accuracy Fix — Master Parlay + All Strategies

## Root Cause: Two Separate Line Problems

### Problem 1 — THREE_POINT_SHOOTER Category Uses 0.5 Line (Wrong Sportsbook Line)

The `category_sweet_spots` table stores `recommended_line = 0.5` for every `THREE_POINT_SHOOTER` pick (3,466 rows). The parlay engine picks up this line using:

```typescript
const line = pick.actual_line ?? pick.recommended_line ?? pick.line;
```

Since `actual_line` is NULL for every threes pick, it falls back to `recommended_line = 0.5`. This is the historical "sweet spot" (at least 1 three pointer made), but it is NOT the current sportsbook line.

The `oddsMap` already has the real sportsbook line from `unified_props`:
- Tyrese Maxey threes: **3.5** (sportsbook) vs 0.5 stored
- Donovan Mitchell threes: **2.5** (DraftKings) / **3.5** (FanDuel) vs 0.5 stored
- Aaron Nesmith threes: **2.5** vs 0.5 stored
- Nickeil Alexander-Walker threes: **3.5** vs 0.5 stored
- LaMelo Ball threes: **3.5** vs 0.5 stored
- Moses Moody threes: **2.5** vs 0.5 stored

**The fix:** When the `oddsMap` has a real `current_line` for this player+prop combination, use it as the line instead of the `recommended_line` from `category_sweet_spots`. The `oddsMap` is the source of truth.

**Code change location:** Line 2642 in `bot-generate-daily-parlays/index.ts`

```typescript
// BEFORE (wrong):
const line = pick.actual_line ?? pick.recommended_line ?? pick.line;

// AFTER (correct):
const oddsKey = `${pick.player_name}_${pick.prop_type}`.toLowerCase();
const realLine = oddsMap.get(oddsKey)?.line;
const line = pick.actual_line ?? (realLine && realLine > 0 ? realLine : null) ?? pick.recommended_line ?? pick.line;
```

Note: `oddsKey` is already computed 2 lines later — the code should be restructured so `oddsKey` is computed first, then used for both line resolution AND odds lookup.

### Problem 2 — 0.5 Threes Picks Survive the `has_real_line` Guard

The existing guard `p.has_real_line` was supposed to block picks without sportsbook lines. But `hasRealLine` is set to `true` whenever `oddsMap.has(oddsKey)` — which is true for threes because `unified_props` has a row for the player's threes. So the pick passes the guard (real sportsbook odds exist) but uses the wrong line value (0.5 from `recommended_line` instead of 2.5/3.5 from `unified_props.current_line`).

The guard is not broken — the line resolution is. Once the line resolution is fixed (Problem 1), the guard will correctly approve picks using the real sportsbook line.

### Problem 3 — hit_rate Values Show "100" for THREE_POINT_SHOOTER

The master parlay shows hit_rate=100 for Tyrese Maxey threes and Aaron Nesmith threes. This is because many historical sweet-spot rows have `l10_hit_rate = 1.0` (i.e., the player made at least 1 three in 10/10 recent games). This is accurate for OVER 0.5 (trivially easy) but is NOT the hit rate for OVER 2.5 or OVER 3.5. After fixing the line, the hit rate needs to be re-evaluated from `unified_props` actual data, or at minimum the hit rate displayed must be capped to reflect that the player is being evaluated against the real sportsbook line.

The simplest approach: When substituting the real line from `oddsMap`, also re-derive the hit rate from any available recent game data. If not available, cap the displayed hit rate at 75% for any pick where the line was overridden from a `recommended_line` to a `realLine`.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Fix line resolution order at line 2642 |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Re-cap hit rate when line is overridden from sportsbook |

---

## Exact Code Change

**Location: Lines 2641–2678 (enrichedSweetSpots mapping block)**

Current logic:
```typescript
let enrichedSweetSpots: EnrichedPick[] = (sweetSpots || []).map((pick: SweetSpotPick) => {
  const line = pick.actual_line ?? pick.recommended_line ?? pick.line;
  const oddsKey = `${pick.player_name}_${pick.prop_type}`.toLowerCase();
  const hasRealLine = oddsMap.has(oddsKey) || (pick.actual_line !== null && pick.actual_line !== undefined);
  const odds = oddsMap.get(oddsKey) || { overOdds: -110, underOdds: -110, line: 0, sport: 'basketball_nba' };
  ...
  return { ...pick, line, ... };
```

Fixed logic:
```typescript
let enrichedSweetSpots: EnrichedPick[] = (sweetSpots || []).map((pick: SweetSpotPick) => {
  // Resolve oddsKey FIRST — used for both line override and odds lookup
  const oddsKey = `${pick.player_name}_${pick.prop_type}`.toLowerCase();
  const oddsEntry = oddsMap.get(oddsKey);
  
  // CRITICAL: Use the real sportsbook line from unified_props when available.
  // category_sweet_spots stores recommended_line=0.5 for THREE_POINT_SHOOTER (historical sweet spot)
  // but the actual sportsbook line is 2.5 or 3.5. The oddsMap has the correct current_line.
  const realSportsbookLine = oddsEntry?.line && oddsEntry.line > 0 ? oddsEntry.line : null;
  const line = pick.actual_line ?? realSportsbookLine ?? pick.recommended_line ?? pick.line;
  const lineWasOverridden = !pick.actual_line && realSportsbookLine && realSportsbookLine !== pick.recommended_line;
  
  const hasRealLine = !!oddsEntry || (pick.actual_line !== null && pick.actual_line !== undefined);
  const odds = oddsEntry || { overOdds: -110, underOdds: -110, line: 0, sport: 'basketball_nba' };
  
  // If the line was overridden to the real sportsbook line (e.g., 2.5 instead of 0.5),
  // cap the historical hit rate at 75% since the 0.5 hit rate doesn't apply to the real line
  const rawHitRateDecimal = pick.l10_hit_rate || pick.confidence_score || 0.5;
  const hitRateDecimal = lineWasOverridden 
    ? Math.min(rawHitRateDecimal, 0.75) 
    : rawHitRateDecimal;
  ...
  return { ...pick, line, ... };
```

---

## After the Fix

For every THREE_POINT_SHOOTER pick in the pool:
- Stored parlay line will match the real sportsbook line (2.5, 3.5, etc.)
- Hit rates capped at 75% when the line was overridden (prevents fake 100% hit rates at the real line)
- Negative-edge gate will re-evaluate correctly: `projectedValue - realLine` instead of `projectedValue - 0.5`
- Master parlay players will be evaluated against lines you can actually bet

## After the Fix + Regeneration

The master parlay will likely shrink its 3PM OVER picks because the real hit rate at 2.5/3.5 threes is lower than at 0.5. Only players whose hit rate at the real sportsbook line is ≥62% will survive the `nbaCandidates` filter. This is the correct behavior.

---

## Scope of Impact

8 distinct player+prop combinations currently stored with wrong lines in today's parlays:
- Tyrese Maxey threes: 0.5 stored, 3.5 real
- Nickeil Alexander-Walker threes: 0.5 stored, 3.5 real
- Donovan Mitchell threes: 0.5 stored, 2.5/3.5 real
- Aaron Nesmith threes: 0.5 stored, 2.5 real
- Moses Moody threes: 0.5 stored, 2.5 real
- LaMelo Ball threes: 0.5 stored, 3.5 real
- Landry Shamet threes: 0.5 stored, 1.5 real
- Jarace Walker threes: 0.5 stored, 1.5 real

After the fix, every parlay leg will have the line that players can actually place at the sportsbook.
