

# Investigation Report: Over/Under Prediction Accuracy Issues

## Executive Summary

The system cannot reliably predict whether players will go over or under because of **3 critical bugs**:

1. **H2H Hit Rates = 0% for ALL Records** - The matchup history table has no actual over/under hit rate calculations
2. **Reliability `should_block` Never Enforced** - Players flagged as unreliable are still included in parlays
3. **Negative Edge Picks Allowed** - The edge filter has a bypass path where picks without projections still slip through

---

## Issue 1: H2H Hit Rates Are All Zeros

### Evidence

Every single record in `matchup_history` has `hit_rate_over = 0.00`:

| Player | Opponent | Avg 3PM | Games | hit_rate_over |
|--------|----------|---------|-------|---------------|
| Stephen Curry | Dallas | 6.7 | 3 | **0.00** |
| Sam Hauser | Indiana | 4.8 | 4 | **0.00** |
| Pascal Siakam | Sacramento | 4.3 | 3 | **0.00** |

### Root Cause

The `sync_matchup_history_from_logs` RPC function calculates:
- `avg_stat` ✓ (average stat value)
- `min_stat` ✓ (worst game)
- `max_stat` ✓ (best game)
- `hit_rate_over` ✗ **NEVER CALCULATED**
- `hit_rate_under` ✗ **NEVER CALCULATED**

The function groups by player/opponent but **does not compare stats to betting lines**, making it impossible to know if a player historically beats a specific line against a specific team.

### Impact

Without H2H hit rates, the system cannot answer: "How often does Coby White go OVER 2.5 threes vs the Celtics?"

---

## Issue 2: Reliability Blocking is Loaded But Never Used

### Evidence from Code

```typescript
// Line 1448-1461: Reliability data is LOADED
const reliabilityMap = new Map();
reliabilityMap.set(key, {
  tier: r.reliability_tier || 'unknown',
  hitRate: r.hit_rate || 0,
  modifier: r.confidence_modifier || 0,
  shouldBlock: r.should_block || false  // ✓ Flag exists
});

// Lines 1504-1544: validCategoryPicks filter
// MISSING: No check for reliability.shouldBlock

// Lines 1561-1609: validRiskPicks filter
// MISSING: No check for reliability.shouldBlock
```

### Database Evidence

Players with `should_block = true` are still appearing in parlays:

| Player | Prop | Hit Rate | should_block |
|--------|------|----------|--------------|
| Darius Garland | points | 0% | **TRUE** |
| Devin Booker | points | 0% | **TRUE** |
| Grayson Allen | threes | 0% | **TRUE** |
| Quentin Grimes | rebounds | 0% | **TRUE** |

### Impact

Players with 0% historical accuracy on specific props are being recommended because the blocking flag is never checked.

---

## Issue 3: Negative Edge Picks Bypass Edge Filter

### Evidence from Database

UNDER picks have **negative edges** but are still marked as active:

| Player | Prop | Side | L10 Avg | Line | Edge |
|--------|------|------|---------|------|------|
| Moussa Diabate | points | under | 8.9 | 14.5 | **-5.60** |
| Donte DiVincenzo | points | under | 12.3 | 19.5 | **-8.50** |
| Bobby Portis | points | under | 12.9 | 19.5 | **-5.50** |

### Root Cause

The `passesMinEdgeThreshold` function at line 197-230:
1. Blocks picks with NULL projections ✓
2. Calculates directional edge ✓
3. **But many category picks have `projected_value = NULL`**, so they bypass the edge filter earlier in the pipeline (lines 1504-1544) before reaching `passesMinEdgeThreshold` (line 928-931)

The filter path is:
1. `validCategoryPicks` → No edge check here
2. `validRiskPicks` → No edge check here
3. `buildSweetSpotParlayCore` → Edge check at step 3.5

But category picks with NULL projections never get their edge validated!

---

## Fix Plan

### Fix 1: Calculate Real H2H Hit Rates (Database)

Update the `sync_matchup_history_from_logs` RPC to cross-reference with historical betting lines:

```sql
-- For each game, determine if player beat the typical line
WITH game_performance AS (
  SELECT 
    player_name,
    opponent,
    threes_made,
    CASE WHEN threes_made > 1.5 THEN 1 ELSE 0 END as beat_1_5,
    CASE WHEN threes_made > 2.5 THEN 1 ELSE 0 END as beat_2_5
  FROM nba_player_game_logs
)
SELECT 
  player_name,
  opponent,
  COUNT(*) as games_played,
  ROUND(AVG(beat_1_5), 2) as hit_rate_over_1_5,
  ROUND(AVG(beat_2_5), 2) as hit_rate_over_2_5
FROM game_performance
GROUP BY player_name, opponent
```

### Fix 2: Add Reliability Block Check (Frontend)

Add this check to both filter functions in `useSweetSpotParlayBuilder.ts`:

```typescript
// In validCategoryPicks filter (around line 1515)
const reliabilityKey = `${playerKey}_${pick.prop_type?.toLowerCase()}`;
const reliability = reliabilityMap.get(reliabilityKey);
if (reliability?.shouldBlock) {
  console.log(`[SweetSpotParlay] Blocking chronic underperformer: ${pick.player_name} ${pick.prop_type}`);
  return false;
}

// In validRiskPicks filter (around line 1575)
const reliabilityKey = `${playerKey}_${pick.prop_type?.toLowerCase()}`;
const reliability = reliabilityMap.get(reliabilityKey);
if (reliability?.shouldBlock) {
  console.log(`[SweetSpotParlay] Blocking chronic underperformer: ${pick.player_name} ${pick.prop_type}`);
  return false;
}
```

### Fix 3: Enforce Edge Check Earlier (Frontend)

Add edge validation in the category picks filter before they enter the pool:

```typescript
// In validCategoryPicks filter
// Calculate edge using l10_avg when projected_value is missing
const projection = pick.projected_value ?? pick.l10_avg;
const line = pick.actual_line ?? pick.recommended_line;
if (!projection || !line) return false;

const isOver = pick.recommended_side?.toLowerCase() === 'over';
const edge = isOver ? (projection - line) : (line - projection);
if (edge < 0) {
  console.log(`[SweetSpotParlay] Blocking negative edge: ${pick.player_name} ${pick.prop_type} ${pick.recommended_side}`);
  return false;
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useSweetSpotParlayBuilder.ts` | Add reliability blocking + edge validation to filter functions |
| Database RPC `sync_matchup_history_from_logs` | Calculate actual H2H hit rates against common lines |
| `supabase/functions/sync-matchup-history/index.ts` | Enhanced H2H sync logic |

---

## Expected Outcome

After these fixes:
- **H2H research will show real hit rates** (e.g., "Coby White hits O2.5 threes 85% of the time vs Celtics")
- **0% hit rate players will be blocked** from all parlay recommendations
- **Negative edge picks will be filtered** before entering the selection pool
- **Over/Under predictions will be data-driven** instead of guesses

---

## Implementation Priority

1. **Fix 2 (Reliability Blocking)** - Immediate, prevents worst picks
2. **Fix 3 (Edge Validation)** - Same day, blocks negative value bets
3. **Fix 1 (H2H Hit Rates)** - Enables real matchup intelligence

