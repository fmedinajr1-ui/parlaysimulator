
# Enhanced 3PT Shooter Selection Logic + Remove Feature Locks

## Status: ✅ IMPLEMENTED

## Overview
This plan added advanced "mother logic" for 3PT shooter selection by incorporating **H2H matchup analysis with boost scoring** and **shooting efficiency tiers**. All route/feature restrictions have been removed.
- L10 hit rate (97%+ threshold)
- L5/L10 variance-edge matrix validation
- H2H matchup data from `v_3pt_matchup_favorites` (ELITE/GOOD/VOLATILE tiers)
- Floor protection (L10 Min >= 2)
- Hot/Cold streak detection (L5 vs L10 ratio)

### Missing Data Elements
1. **3PT Shooting Percentage**: The `nba_player_game_logs` table has `threes_made` but no `threes_attempted` column - we cannot calculate shooting efficiency (3P%)
2. **H2H Integration**: Matchup history exists but is not fully integrated into the selection scoring formula

### Feature Lock System
- `PilotRouteGuard.tsx` restricts pilot users to 23 specific routes
- Redirects blocked routes to `/profile?restricted=true`
- `PilotUserContext.tsx` tracks user access levels

---

## Implementation Plan

### Part 1: Remove All Feature Locks

**File: `src/components/PilotRouteGuard.tsx`**

Simplify the guard to always allow access:

```text
Current behavior:
- Checks isPilotUser flag
- Compares route against PILOT_ALLOWED_ROUTES
- Redirects unauthorized routes

New behavior:
- Always render children (full access for all users)
- Keep component for future feature gating if needed
```

This will:
- Allow all users access to all routes
- Remove the "Feature Locked" toast messages
- Simplify navigation across the app

### Part 2: Add 3PT Shooting Percentage Column

**Database Migration:**
Add `threes_attempted` column to `nba_player_game_logs` to enable 3PT% calculations:

```sql
ALTER TABLE nba_player_game_logs
ADD COLUMN IF NOT EXISTS threes_attempted integer DEFAULT 0;
```

Update the NBA stats fetcher edge function to populate this field when syncing game data.

### Part 3: Enhanced H2H Matchup Integration

**File: `src/hooks/useEliteThreesBuilder.ts`**

Add H2H hit rate intelligence to the pick scoring:

```text
Current H2H data available:
- avg_3pt_vs_team (average threes vs specific opponent)
- worst_3pt_vs_team (floor performance)
- best_3pt_vs_team (ceiling performance)
- matchup_tier (ELITE/GOOD/VOLATILE)

New scoring formula additions:
1. H2H Boost Factor:
   - ELITE_MATCHUP + floor >= line: +15% score boost
   - ELITE_MATCHUP: +10% score boost
   - GOOD_MATCHUP: +5% score boost
   - VOLATILE_MATCHUP: -5% penalty (or block)

2. Today's Matchup Integration:
   - Parse opponent from unified_props/game_description
   - Cross-reference with matchup_history
   - Apply specific H2H hit rate from historical data
```

### Part 4: Add Recent Shooting Efficiency Logic

**File: `src/hooks/useEliteThreesBuilder.ts`**

Once `threes_attempted` is available, add shooting efficiency filtering:

```text
New validation criteria:
1. L5 3PT% calculation:
   - 3PT% = SUM(threes_made) / SUM(threes_attempted) over L5 games
   
2. Efficiency tiers:
   - HOT SHOOTING: L5 3PT% >= 40% (elite efficiency)
   - NORMAL: L5 3PT% 30-40%
   - COLD SHOOTING: L5 3PT% < 30% (flag as risk)

3. Volume requirement:
   - Minimum 3 attempts per game average to qualify
   - Prevents low-volume shooters from skewing %
```

### Part 5: Update Category Props Analyzer

**File: `supabase/functions/category-props-analyzer/index.ts`**

Enhance the THREE_POINT_SHOOTER category analysis:

```text
New fields to calculate and store:
- l5_three_pct (shooting efficiency)
- h2h_hit_rate_vs_opponent (specific opponent H2H)
- h2h_avg_vs_opponent (average threes vs opponent)
- combined_confidence_score (weighted blend)

Updated scoring formula:
confidence = (
  L10_hit_rate * 0.30 +
  L5_momentum * 0.20 +
  H2H_matchup_factor * 0.20 +
  L5_shooting_efficiency * 0.15 +
  Floor_protection * 0.15
)
```

---

## Technical Details

### Database Schema Changes

```sql
-- Add 3PT attempts tracking
ALTER TABLE nba_player_game_logs
ADD COLUMN IF NOT EXISTS threes_attempted integer DEFAULT 0;

-- Add index for efficient L5 queries
CREATE INDEX IF NOT EXISTS idx_game_logs_player_date 
ON nba_player_game_logs(player_name, game_date DESC);

-- Update category_sweet_spots with new fields
ALTER TABLE category_sweet_spots
ADD COLUMN IF NOT EXISTS l5_three_pct numeric,
ADD COLUMN IF NOT EXISTS h2h_matchup_boost numeric;
```

### Hook Changes Summary

| File | Changes |
|------|---------|
| `PilotRouteGuard.tsx` | Simplify to allow all access |
| `useEliteThreesBuilder.ts` | Add H2H scoring, 3PT% validation |
| `use3PTMatchupAnalysis.ts` | Add hit rate calculation from matchup_history |
| `useTodayProps.ts` | Include H2H data in pick enrichment |

### Edge Function Updates

| Function | Changes |
|----------|---------|
| `nba-stats-fetcher` | Fetch and store `threes_attempted` |
| `category-props-analyzer` | Calculate 3PT%, H2H boost, enhanced scoring |
| `verify-sweet-spot-outcomes` | No changes needed |

---

## Files to Modify

1. `src/components/PilotRouteGuard.tsx` - Remove route restrictions
2. `src/hooks/useEliteThreesBuilder.ts` - Add H2H/efficiency scoring
3. `src/hooks/use3PTMatchupAnalysis.ts` - Add hit rate calculations
4. `supabase/functions/category-props-analyzer/index.ts` - Enhanced 3PT logic
5. `supabase/functions/nba-stats-fetcher/index.ts` - Add threes_attempted
6. Database migration for new columns

## Expected Outcome

After implementation:
- All users have full access to all app features
- 3PT shooter selection incorporates:
  - Recent shooting efficiency (L5 3PT%)
  - Specific H2H matchup history and hit rates
  - Volume validation (minimum attempts)
- Higher accuracy predictions through multi-factor scoring
