
# Apply 3 NCAAB Scoring Fixes — Exact Code Changes

## Confirmed Current State (from file reads)

All bugs are confirmed present in the live code. Exact line numbers verified:

- **Line 200**: `validKenpomD` max is 120 — blocks 75 D1 teams with defensive ratings 120–138
- **Lines 329–334**: Broken formula `((homeOff + awayOff) * tempoFactor / 100) * 2` → produces ~4.7 → clamped to 100 every time
- **Lines 341–358**: Raw `lineEdge` bonus/penalty block with no PPG sanity guard
- **Lines 3113–3117**: NCAAB OVER block ends at line 3117 — circuit breaker goes immediately after
- **Lines 218–219**: `homePPG` and `awayPPG` are confirmed in scope at the insertion point

---

## Edit 1 — Widen validKenpomD (line 200, team-bets-scoring-engine)

**Current:**
```ts
const validKenpomD = (v: number | null | undefined) => v != null && v >= 80 && v <= 120;
```
**Fixed:**
```ts
const validKenpomD = (v: number | null | undefined) => v != null && v >= 80 && v <= 140;
```

Teams like Delaware (121.6), East Carolina (122.0), Bucknell (128.1) currently fail this check and fall back to the `adj_defense` column instead. Widening to 140 covers the full real D1 range (max observed: 138.1) and ensures `hasRealKenpom` can be properly set for all teams.

---

## Edit 2 — Fix the Projected Total Formula (lines 329–334, team-bets-scoring-engine)

**Current (broken):**
```ts
if (hasRealKenpom) {
  // Real KenPom: (AdjO_home + AdjO_away) * tempo / 100 is standard method
  // But we need to account for both sides' offense vs opponent defense
  projectedTotal = ((homeOff + awayOff) * tempoFactor / 100) * 2;
  // Clamp to reasonable range
  projectedTotal = Math.max(100, Math.min(200, projectedTotal));
}
```

The problem: `homeOff` is ~107–123 (KenPom per-100-possession ratings). Dividing by 100 gives ~1.07. Multiplying by `tempoFactor` (~0.96) gives ~2.06. Times 2 = ~4.12. Clamped to 100 — every single time.

**Fixed (possession-adjusted KenPom formula):**
```ts
if (hasRealKenpom) {
  // Correct KenPom possession-adjusted formula:
  // AdjO = points scored per 100 possessions against avg D1 defense
  // AdjD = points allowed per 100 possessions against avg D1 offense
  // To project home points: homeOff × (awayDef / 100) × avgTempo / 100
  // This gives: "how many pts home team scores vs this specific defense over avgTempo possessions"
  const homePts = homeOff * (awayDef / 100) * avgTempo / 100;
  const awayPts = awayOff * (homeDef / 100) * avgTempo / 100;
  projectedTotal = homePts + awayPts;
  projectedTotal = Math.max(115, Math.min(195, projectedTotal));
}
```

**Example output for George Mason (AdjO: 123.3, AdjD: 104.2, Tempo: 62.3) vs Dayton (AdjO: 121.1, AdjD: 106.4, Tempo: 64.7):**
- avgTempo = 63.5
- homePts = 123.3 × (106.4/100) × 63.5/100 = **83.3**
- awayPts = 121.1 × (104.2/100) × 63.5/100 = **80.1**
- `projected_total = 163.4` — line was 136.5 → `lineEdge = +26.9` → **OVER value, zero Under bonus**

The fallback formula on lines 335–339 is left unchanged (applies when `hasRealKenpom = false`).

---

## Edit 3 — PPG Sanity Guard Wrapping the lineEdge Block (lines 341–358, team-bets-scoring-engine)

`homePPG` (line 218) and `awayPPG` (line 219) are already declared in scope here.

**Current (lines 341–358):**
```ts
const lineEdge = projectedTotal - (bet.line || 0);
breakdown.projected_total = Math.round(projectedTotal * 10) / 10;

if (side === 'OVER' && lineEdge < -5) {
  const penalty = clampScore(-15, 0, Math.round(lineEdge * 2));
  score += penalty;
  breakdown.line_inflated = penalty;
  breakdown.line_edge_label = `Proj ${projectedTotal.toFixed(0)} vs Line ${bet.line} (inflated)`;
} else if (side === 'UNDER' && lineEdge < -3) {
  const bonus = clampScore(0, 12, Math.round(Math.abs(lineEdge) * 2));
  score += bonus;
  breakdown.line_value = bonus;
  breakdown.line_edge_label = `Proj ${projectedTotal.toFixed(0)} vs Line ${bet.line} (value under)`;
} else if (side === 'OVER' && lineEdge > 3) {
  score += 5;
  breakdown.line_value = 5;
  breakdown.line_edge_label = `Proj ${projectedTotal.toFixed(0)} vs Line ${bet.line} (value over)`;
}
```

**Fixed (wrapped in PPG sanity guard):**
```ts
breakdown.projected_total = Math.round(projectedTotal * 10) / 10;

// PPG sanity guard: if projection is implausibly low vs teams' real scoring averages,
// skip the line-edge bonus/penalty entirely — the projection cannot be trusted
const combinedPPG = (homePPG || 0) + (awayPPG || 0);
const projectionIsSane = combinedPPG <= 100 || projectedTotal >= combinedPPG * 0.85;

if (!projectionIsSane) {
  breakdown.projection_sanity_fail = 1;
  breakdown.sanity_label = `Proj ${projectedTotal.toFixed(0)} < 85% of combined PPG ${combinedPPG.toFixed(0)} — line edge skipped`;
} else {
  const lineEdge = projectedTotal - (bet.line || 0);
  if (side === 'OVER' && lineEdge < -5) {
    const penalty = clampScore(-15, 0, Math.round(lineEdge * 2));
    score += penalty;
    breakdown.line_inflated = penalty;
    breakdown.line_edge_label = `Proj ${projectedTotal.toFixed(0)} vs Line ${bet.line} (inflated)`;
  } else if (side === 'UNDER' && lineEdge < -3) {
    const bonus = clampScore(0, 12, Math.round(Math.abs(lineEdge) * 2));
    score += bonus;
    breakdown.line_value = bonus;
    breakdown.line_edge_label = `Proj ${projectedTotal.toFixed(0)} vs Line ${bet.line} (value under)`;
  } else if (side === 'OVER' && lineEdge > 3) {
    score += 5;
    breakdown.line_value = 5;
    breakdown.line_edge_label = `Proj ${projectedTotal.toFixed(0)} vs Line ${bet.line} (value over)`;
  }
}
```

Safety check: for today's lost picks, George Mason (74.5 ppg) + Dayton (75.8 ppg) = combined PPG 150.3. Minimum sane projection = 127.8. Even if the formula had somehow still output 100, the guard would catch it and award zero bonus. This is an independent failsafe.

---

## Edit 4 — Circuit Breaker in bot-generate-daily-parlays (after line 3117)

The NCAAB OVER block ends at line 3117 (`return false;` + closing brace). The new guard goes immediately after:

**Insert after line 3117:**
```ts
// === CIRCUIT BREAKER: Block NCAAB totals where projected_total is the hardcoded 100 fallback ===
// This is an independent backstop — even if the scorer produces a broken projection in an
// edge case, picks built on projected_total ≤ 100 against lines > 125 never enter parlays
if (isNCAAB && pick.bet_type === 'total') {
  const breakdown = pick.score_breakdown as any;
  const projTotal = breakdown?.projected_total;
  const line = pick.line || 0;
  if (projTotal !== undefined && projTotal <= 100 && line > 125) {
    mlBlocked.push(
      `${pick.home_team} vs ${pick.away_team} NCAAB total BLOCKED — projected_total=${projTotal} is hardcoded fallback, line=${line}`
    );
    return false;
  }
}
```

---

## Files Changed Summary

| File | Line(s) | Change |
|---|---|---|
| `supabase/functions/team-bets-scoring-engine/index.ts` | 200 | `v <= 120` → `v <= 140` |
| `supabase/functions/team-bets-scoring-engine/index.ts` | 329–334 | Replace broken formula with `homeOff × (awayDef/100) × avgTempo/100` |
| `supabase/functions/team-bets-scoring-engine/index.ts` | 341–358 | Wrap lineEdge block in PPG sanity guard |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | After 3117 | Add `projected_total ≤ 100` circuit breaker |

No database changes. No schema migrations. Both functions auto-deploy after the edits are saved.

---

## What Happens Immediately After Deploy

1. Both edge functions redeploy automatically
2. The team-bets-scoring-engine needs to be re-triggered to re-score today's existing `game_bets` rows — either via its next scheduled run or a manual invocation
3. After re-scoring, all NCAAB total picks will show `projected_total` in the 140–170 range instead of 100
4. Games with OVER value (projected > line) will no longer receive the +12 Under bonus — composite scores for today's failing picks drop from 93–95 to ~55–65
5. The circuit breaker in the generator means even stale `projected_total: 100` rows in the database are blocked at generation time before they ever enter a parlay
6. Genuine slow-pace Under games (two teams averaging ~64 ppg each, line ~128) still score correctly — the formula produces projections near the line and rewards the Under through the existing defensive efficiency and tempo layers
