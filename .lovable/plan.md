
# Fix NCAA Baseball Parlays + Block NCAAB Player Props

## Problems Found

1. **Baseball profiles pull basketball bets**: The team profile filtering (line 1848-1851) only filters by `betTypes` but ignores the `sports` filter. So a profile like `{ sports: ['baseball_ncaa'], betTypes: ['spread'] }` pulls ALL spreads across all sports, not just baseball.

2. **NCAAB player props are still used in parlays**: There is no filter blocking `basketball_ncaab` player props. The player pick pool includes any sport from `unified_props` and `category_sweet_spots`, including NCAAB players.

## Changes

### 1. Fix sport filtering for team profiles

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts` (~line 1848-1851)

Add sport filtering to the team profile branch so it respects `profile.sports`:

```text
Before:
  if (isTeamProfile) {
    candidatePicks = pool.teamPicks.filter(p => 
      profile.betTypes!.includes(p.bet_type)
    );

After:
  if (isTeamProfile) {
    candidatePicks = pool.teamPicks.filter(p => {
      if (!profile.betTypes!.includes(p.bet_type)) return false;
      // Apply sport filter
      if (sportFilter.includes('all')) return true;
      return sportFilter.includes(p.sport);
    });
```

### 2. Block NCAAB player props entirely

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Add a filter after the enriched sweet spots are built (around line 1481 and line 1547) to exclude any picks where `sport` is `basketball_ncaab`. This ensures NCAAB player props never enter the pick pool.

```text
// After enriching sweet spots, remove NCAAB player props
enrichedSweetSpots = enrichedSweetSpots.filter(p => p.sport !== 'basketball_ncaab');
```

Same filter applied in the fallback unified_props path.

### 3. Redeploy and regenerate

- Deploy the updated `bot-generate-daily-parlays` edge function
- Regenerate today's parlays to verify:
  - Baseball profiles produce baseball-only legs (or skip if no baseball games today)
  - No NCAAB player props appear in any parlay
  - NCAAB team bets (spreads/totals) still work in their dedicated profiles
