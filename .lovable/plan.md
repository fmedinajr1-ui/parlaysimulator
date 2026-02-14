
# Fix NCAAB Total Over Bias -- Add Projected Total vs Line Check

## Problem
The scoring engine recommends OVER on almost every NCAAB total because:
1. The tempo thresholds leave a "dead zone" (65-70) where neither OVER nor UNDER gets a tempo bonus, and OVER wins by default
2. There is NO comparison of the posted line against the teams' projected scoring output
3. Sharp score confirmation stacks on top, inflating OVER scores further

Today's results: 3 of 5 NCAAB total overs missed badly (by 10-28 points). The 2 that hit (Bucknell/BU, GT/ND) had lower lines relative to actual output.

## Solution

### 1. Add Projected Total Calculation to NCAAB Scoring
**File:** `supabase/functions/team-bets-scoring-engine/index.ts` (lines 164-196)

Add a KenPom-style projected total using the formula:
```
projectedTotal = (homeOff / avgDef) * (awayOff / avgDef) * avgTempo * 2
```
(Simplified: `(homeOff + awayOff) * avgTempo / 67` as a baseline estimate)

Then compare projected total to the posted line:
- If OVER and projected total is BELOW the line by 5+ points: apply a **-10 to -15 penalty** ("line is inflated")
- If UNDER and projected total is BELOW the line by 5+ points: apply a **+8 to +12 bonus** ("line is too high")
- If OVER and projected total is ABOVE the line: apply a **+5 bonus** ("value over")

This single change would have correctly flagged:
- UCLA/Michigan (projected ~140 vs line 155.5 = UNDER recommended)
- TAMU/Vanderbilt (projected ~150 vs line 165.5 = UNDER recommended)
- Northwestern/Nebraska (projected ~130 vs line 145.5 = UNDER recommended)

### 2. Tighten the Tempo Dead Zone
Adjust the tempo thresholds so there is no gap:
- OVER bonus: tempo >= 67 (was >70)
- UNDER bonus: tempo < 67 (was <65)
- Keep the mismatch penalty for extreme cases (OVER + tempo < 62, UNDER + tempo > 72)

### 3. Add UNDER Total Profiles to Generator
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Add exploration and execution profiles for NCAAB under totals:
- Exploration: `{ legs: 3, strategy: 'ncaab_unders', sports: ['basketball_ncaab'], betTypes: ['total'] }` (with side filter for UNDER)
- Execution: same with `minHitRate: 55, sortBy: 'composite'`

This ensures the generator can build UNDER-focused parlays when the scoring engine recommends them, instead of only building OVER parlays.

### 4. Re-run Scoring Engine After Deploy
After deploying the updated scoring engine, re-run it to rescore all active totals. Future parlays will then pull from a balanced pool of OVER and UNDER recommendations.

## Technical Details

**Projected total formula** (KenPom-inspired):
```typescript
// Estimate expected total from efficiency + tempo
const avgDef = 67; // D1 average defensive efficiency
const tempoFactor = (homeTempo + awayTempo) / 2 / 67;
const projectedTotal = ((homeOff + awayOff) / 2) * tempoFactor * 2;
const lineEdge = projectedTotal - (bet.line || 0);

// Line edge scoring
if (side === 'OVER' && lineEdge < -5) {
  const penalty = clampScore(-15, 0, lineEdge * 2);
  score += penalty;
  breakdown.line_inflated = penalty;
} else if (side === 'UNDER' && lineEdge < -3) {
  const bonus = clampScore(0, 12, Math.abs(lineEdge) * 2);
  score += bonus;
  breakdown.line_value = bonus;
} else if (side === 'OVER' && lineEdge > 3) {
  score += 5;
  breakdown.line_value = 5;
}
```

**Files to edit:**
- `supabase/functions/team-bets-scoring-engine/index.ts` -- add projected total logic and tighten tempo thresholds
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- add NCAAB under total profiles

## Expected Impact
- Eliminates blind OVER bias on inflated lines
- Today's 3 losing overs would have been correctly flagged as UNDER recommendations
- System can now generate UNDER-focused parlays when the data supports it
- Maintains existing quality floor (composite >= 62) for all picks
