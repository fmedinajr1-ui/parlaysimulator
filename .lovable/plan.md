

## Fix: Always Populate Defense Rank on Picks for Line Adjustment System

### Problem
The defensive downgrade and offensive upgrade system (`shouldAdjustLine()`) is currently non-functional because it lacks data. Today's 35 pending parlays had **zero** line adjustments applied.

**Root cause**: `defenseMatchupRank` is only set on picks when `adj !== 0` (line 5069), meaning picks with neutral defensive adjustments never get a defense rank stored. The `shouldAdjustLine()` function exits early at line 361 when it finds `null`.

### What's Working
- The `shouldAdjustLine()` logic is correctly coded for both downgrades and upgrades
- The `findAvailableAltLine()` lookup is properly wired
- The leg metadata fields (`was_line_adjusted`, `line_adjustment_direction`, etc.) are correctly stored
- The 2 picks that DO have defense_rank (Duncan Robinson rank 1, Dean Wade rank 27) were correctly evaluated and correctly NOT adjusted (one is an under helped by elite defense, other has too small a buffer)

### Changes Required

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

#### 1. Always store `defenseMatchupRank` on enriched sweet spot picks (around line 5069)
Currently:
```typescript
if (adj !== 0) {
  pick.compositeScore = ...;
  (pick as any).defenseMatchupRank = rank;
  (pick as any).defenseMatchupAdj = adj;
}
```
Change to always store the rank regardless of adjustment value:
```typescript
// Always store defense rank for line adjustment system
if (rank != null) {
  (pick as any).defenseMatchupRank = rank;
  (pick as any).defenseMatchupAdj = adj;
}
if (adj !== 0) {
  pick.compositeScore = ...;
}
```

#### 2. Store opponent team name on picks for `shouldAdjustLine()` fallback
After computing `oppTeamName` at line 5077, also store it on the pick:
```typescript
(pick as any).opponent_team = oppTeamName || '';
```
This enables the secondary defense lookup path inside `shouldAdjustLine()` (lines 337-338).

#### 3. Same fix for mispriced/master candidates enrichment loop (around line 5460)
The same pattern exists in the second enrichment loop for mispriced and master candidate picks. Apply the same two changes:
- Always store `defenseMatchupRank` even when `adj === 0`
- Store `opponent_team` on the pick

### Impact
- All NBA picks will now have `defenseMatchupRank` populated (instead of only the ~10% that had non-zero adjustments)
- `shouldAdjustLine()` will be able to evaluate every pick against its matchup context
- Picks like Jarrett Allen (rebounds OVER 8.5, buffer 3.77) facing weak defenses will be properly evaluated for upgrades
- Picks facing top-10 defenses with tight margins will be properly evaluated for downgrades
- No behavioral change for picks where defense data is genuinely unavailable (non-NBA, missing schedule data)

### Files Modified
- `supabase/functions/bot-generate-daily-parlays/index.ts` — ~6 lines changed across 2 enrichment loops

