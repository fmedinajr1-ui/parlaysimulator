✅ COMPLETED


# Implement 6 Scoring Gaps in Bot Parlay Builder

## Overview

Six scoring/filtering improvements to the parlay generation engine in `supabase/functions/bot-generate-daily-parlays/index.ts` that add mathematical rigor to leg selection, parlay construction, and round robin quality gates.

---

## Gap 1: Dynamic Hit-Rate Weight by Parlay Size

**Current**: `calculateCompositeScore` uses a fixed 40% weight for hit rate regardless of parlay size.

**Change**: Accept an optional `legCount` parameter. When building 4+ leg parlays, shift weight distribution to emphasize hit rate (50%) at the expense of odds value and category weight (15% each). Edge stays at 20%.

**Where**: Modify `calculateCompositeScore` (line ~890) to accept `legCount?: number`. Update all call sites to pass the profile's target leg count where available.

---

## Gap 2: Per-Leg Minimum Score Gate by Parlay Size

**Current**: No minimum composite score threshold applied per-leg during parlay construction (only hit-rate and odds-value floors exist).

**Change**: Add a `minScoreByParlaySize` function:
- 3 legs or fewer: minimum composite score 80
- 4-5 legs: minimum 90
- 6+ legs: minimum 95

Apply this gate inside the parlay construction loop (line ~2925) as a `continue` check after `compositeScore` is computed.

---

## Gap 3: Leg-Count Penalty (House Edge Cost)

**Current**: Parlay combined probability and edge are computed purely from leg products. No penalty for increasing leg count.

**Change**: After computing `combinedProbability` and `effectiveEdge` (line ~3206), apply a 3% multiplicative penalty per leg beyond 3:

```
parlayPenalty = 1 - 0.03 * max(0, legCount - 3)
adjustedEdge = effectiveEdge * parlayPenalty
```

Use `adjustedEdge` for the edge floor check instead of raw `effectiveEdge`. Log the penalty when applied.

---

## Gap 4: Correlation Tax (Same-Game Haircut)

**Current**: Same-game legs are partially controlled by `canAddTeamLegToParlay` (blocks same bet-type), but no penalty for legs from the same game across different bet types.

**Change**: After building the parlay legs array, detect if any two legs share the same `event_id` or the same `home_team + away_team` combination. If so, apply a 15% haircut to the parlay edge:

```
if (hasSameGameLegs) adjustedEdge *= 0.85
```

Add a helper `hasSameGameCorrelation(legs)` that checks for overlapping games. Log when the tax is applied.

---

## Gap 5: Parlay-Level Composite Score Floor

**Current**: Tier thresholds check only probability, edge, and Sharpe ratio. No parlay-level composite score validation.

**Change**: After computing all legs, calculate `avgLegCompositeScore` as the mean of each leg's `composite_score`. Apply a floor by tier:
- Exploration: 75
- Validation: 80
- Execution: 85

Reject parlays where the average leg score falls below the tier's floor. Apply leg-count penalty to this average score too.

---

## Gap 6: Round Robin EV and Score Gates

**Current**: Round robin sub-parlays and mega-parlay have no EV or composite score quality gates. Any 4-leg combination from elite legs is accepted.

**Change**: In `generateRoundRobinParlays` (line ~3379), filter sub-parlay combos:
- Require `edge >= 0.02` (2% minimum EV at parlay level)
- Require average `composite_score >= 82` across the 4 legs
- Skip combos that fail either gate

Also apply the leg-count penalty (Gap 3) to round robin edge calculations.

---

## Technical Details

### Modified Functions

1. **`calculateCompositeScore`** (line 890-928) -- add `legCount` parameter for dynamic weighting
2. **Parlay construction loop** (line 2925-3127) -- add per-leg score gate (Gap 2)
3. **Post-construction validation** (line 3186-3219) -- add leg-count penalty (Gap 3), correlation tax (Gap 4), avg score floor (Gap 5)
4. **`generateRoundRobinParlays`** (line 3289-3444) -- add EV and score gates (Gap 6)

### New Helper Functions

```text
minScoreByParlaySize(legs: number): number
parlayLegCountPenalty(legs: number): number
hasSameGameCorrelation(legs: any[]): boolean
parlayScoreFloor(tier: TierName): number
```

### Call Site Updates for calculateCompositeScore

- Line ~2037: enriching sweet spots -- pass `undefined` (no parlay context yet)
- Line ~2116: fallback enrichment -- same
- The per-leg score gate in Gap 2 will use the already-computed composite score; no re-computation needed since the dynamic weight only matters at selection time. The per-leg gate uses the stored score.

### Logging

Each new gate will log rejections at the execution tier level for visibility:
- `[ScoreGate] Blocked leg X (score Y < Z for N-leg parlay)`
- `[LegPenalty] Applied 3% x N penalty to edge`
- `[CorrTax] Same-game correlation tax applied (15% haircut)`
- `[ParlayFloor] Rejected parlay (avg score X < Y floor)`
- `[RoundRobin] Skipped combo (edge X < 0.02 or avg score Y < 82)`

