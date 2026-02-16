

# Include Sweet Spots in Single Pick Fallback

## Problem
The single pick fallback (line 4578) merges only three pool sources when building candidates:
- `pool.teamPicks`
- `pool.playerPicks`
- `pool.whalePicks`

It completely skips `pool.sweetSpots`, which contains enriched player props from `category_sweet_spots` -- the same data that powers the high-accuracy categories like 3PT Shooters (80% hit rate) and Sweet Spots (67%). On light-slate days when whale signals dominate, this means you're missing your best-performing picks.

## Fix
One change in `supabase/functions/bot-generate-daily-parlays/index.ts`:

### Modify the `allPicksForSingles` merge (line 4578-4584)

Add `pool.sweetSpots` to the merged array with `pickType: 'player'` (since sweet spots are player props), then deduplicate by player+prop+side to avoid duplicates with `pool.playerPicks`:

```
const allPicksForSingles: any[] = [
  ...pool.teamPicks.map(p => ({ ...p, pickType: 'team' })),
  ...pool.playerPicks.map(p => ({ ...p, pickType: 'player' })),
  ...pool.whalePicks.map(p => ({ ...p, pickType: 'whale' })),
  ...pool.sweetSpots.map(p => ({ ...p, pickType: 'player' })),
]
  .filter(p => !BLOCKED_SPORTS.includes(p.sport || 'basketball_nba'))
  // Deduplicate: if a sweet spot and a playerPick share the same key, keep the higher-scoring one
  .reduce((acc, pick) => {
    const key = pick.pickType === 'team'
      ? `${pick.home_team}_${pick.away_team}_${pick.bet_type}_${pick.side}`.toLowerCase()
      : `${pick.player_name}_${pick.prop_type}_${pick.recommended_side || pick.side}`.toLowerCase();
    const existing = acc.get(key);
    if (!existing || (pick.compositeScore || 0) > (existing.compositeScore || 0)) {
      acc.set(key, pick);
    }
    return acc;
  }, new Map())
  .values()
]
  .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
```

Add a log line after the merge so you can verify in logs:

```
console.log(`[Bot v2] Single pick pool: ${allPicksForSingles.length} candidates (team=${pool.teamPicks.length}, player=${pool.playerPicks.length}, whale=${pool.whalePicks.length}, sweetSpots=${pool.sweetSpots.length})`);
```

## Impact
- On light-slate days (like today), sweet spot picks with 60-80%+ hit rates will now be included as single bet candidates
- Deduplication ensures no double-counting when a player appears in both `playerPicks` and `sweetSpots`
- Existing weight checks, spread caps, and tier thresholds still apply -- no safety gates are bypassed
- The sort-by-composite-score ensures the best sweet spots naturally surface to the top tiers (execution/validation)

## Files Changed
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- modify lines 4578-4584 in the single pick fallback section
