

# Matchup Scanner Accuracy Review

## Current State: NOT TRACKED

The Matchup Scanner **does not have outcome tracking**. Unlike other systems (Sweet Spots, 3PT Shooters, Lock Mode, Whale Proxy), the scanner:

1. **Runs client-side only** - Analysis happens in the browser via `usePreGameMatchupScanner.ts`
2. **Is not persisted** - No edge function saves scanner picks to the database
3. **Cannot be verified** - Without persistence, `verify-sweet-spot-outcomes` cannot settle them

---

## Comparison: What Works vs. What's Missing

| System | Persistence | Verification | Dashboard |
|--------|-------------|--------------|-----------|
| Sweet Spots | `category_sweet_spots` via `category-props-analyzer` | `verify-sweet-spot-outcomes` | Yes |
| 3PT Shooters | `category_sweet_spots` (category = THREE_POINT_SHOOTER) | Same | Yes |
| Lock Mode | `scout_prop_outcomes` via `scout-agent-loop` | `verify-scout-outcomes` | Yes |
| Whale Proxy | `whale_picks` via `whale-signal-detector` | `verify-whale-outcomes` | Yes |
| **Matchup Scanner** | **NONE** | **NONE** | **No** |

---

## Implementation Plan: Add Accuracy Tracking

### Step 1: Create Edge Function to Persist Matchup Picks

Create `supabase/functions/generate-matchup-scanner-picks/index.ts`:

- Mirror the logic from `usePreGameMatchupScanner.ts` (zone analysis, side determination, edge scoring)
- Save picks to `category_sweet_spots` with category = `MATCHUP_SCANNER_PTS` or `MATCHUP_SCANNER_3PT`
- Run daily via cron before games start

Key fields to persist:
```typescript
{
  category: 'MATCHUP_SCANNER_PTS', // or MATCHUP_SCANNER_3PT
  player_name: analysis.playerName,
  prop_type: 'points', // or 'threes'
  recommended_side: analysis.recommendedSide, // 'over' or 'under'
  confidence_score: analysis.edgeScore,
  analysis_date: today,
  outcome: 'pending',
  // Zone analysis metadata
  engine_version: 'matchup_scanner_v1'
}
```

### Step 2: Leverage Existing Verification

The `verify-sweet-spot-outcomes` function already handles:
- Fetching game logs from `nba_player_game_logs`
- Matching player names (normalized)
- Extracting stats (points, threes_made)
- Determining hit/miss/push outcomes
- Updating `category_sweet_spots` with `actual_value`, `outcome`, `settled_at`

No changes needed - scanner picks will automatically verify once persisted.

### Step 3: Update Accuracy Dashboard RPC

Modify `get_unified_system_accuracy` to add Matchup Scanner section:

```sql
-- Matchup Scanner (Points)
RETURN QUERY
SELECT 
  'matchup_scanner_pts'::TEXT as system_name,
  'Matchup Scanner (Points)'::TEXT as display_name,
  '📊'::TEXT as icon,
  -- ... same aggregation pattern ...
FROM category_sweet_spots css
WHERE css.category = 'MATCHUP_SCANNER_PTS'
  AND css.analysis_date >= current_date - days_back;

-- Matchup Scanner (3PT)
RETURN QUERY
SELECT 
  'matchup_scanner_3pt'::TEXT as system_name,
  'Matchup Scanner (3PT)'::TEXT as display_name,
  '🏀'::TEXT as icon,
  -- ... same aggregation pattern ...
FROM category_sweet_spots css
WHERE css.category = 'MATCHUP_SCANNER_3PT'
  AND css.analysis_date >= current_date - days_back;
```

---

## Technical: Data Format Alignment

### Zone-Based Analysis → Prop Selection

Current scanner outputs:
- `propEdgeType`: `'points'` | `'threes'` | `'both'` | `'none'`
- `recommendedSide`: `'over'` | `'under'` | `'pass'`
- `edgeScore`: Absolute matchup advantage (higher = better)
- `sideStrength`: `'strong'` | `'moderate'` | `'lean'`

For persistence, we need to map this to actual lines from `unified_props`:
1. Fetch today's props for the player
2. Find points/threes lines from active books
3. Persist with `recommended_line` = best available line
4. Filter to only `strong` or `moderate` confidence (skip `lean` and `pass`)

### Line Matching Strategy

```typescript
// Filter to actionable picks only
if (analysis.recommendedSide === 'pass') continue;
if (analysis.sideStrength === 'lean') continue;

// Determine which prop type to persist
if (analysis.propEdgeType === 'points' || analysis.propEdgeType === 'both') {
  // Fetch points line from unified_props
  const pointsLine = await getLine(player, 'points');
  if (pointsLine) {
    await savePick('MATCHUP_SCANNER_PTS', 'points', pointsLine);
  }
}

if (analysis.propEdgeType === 'threes' || analysis.propEdgeType === 'both') {
  // Fetch threes line from unified_props  
  const threesLine = await getLine(player, 'threes');
  if (threesLine) {
    await savePick('MATCHUP_SCANNER_3PT', 'threes', threesLine);
  }
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/generate-matchup-scanner-picks/index.ts` | **CREATE** | Edge function to persist scanner picks daily |
| `get_unified_system_accuracy` RPC | **MODIFY** | Add MATCHUP_SCANNER_PTS and MATCHUP_SCANNER_3PT sections |

---

## Expected Outcome

After implementation:
1. Scanner picks get saved to `category_sweet_spots` with category `MATCHUP_SCANNER_*`
2. Games conclude → `verify-sweet-spot-outcomes` settles them automatically
3. Accuracy dashboard shows scanner hit rates alongside other systems
4. Users can see: "Matchup Scanner (Points): 58% hit rate (47 picks)"

---

## Accuracy Thresholds for Validation

Once tracking is live, monitor for:
- **Target**: 55%+ hit rate (profitable with typical -110 odds)
- **Points OVER picks**: Should align with weak defense rankings (26-30)
- **Points UNDER picks**: Should align with strong defense rankings (1-5)
- **3PT picks**: Should align with perimeter defense rankings

This creates a feedback loop to refine the `determineSide()` thresholds if accuracy underperforms.

