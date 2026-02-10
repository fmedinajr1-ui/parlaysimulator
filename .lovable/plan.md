

# Fix: Category Diversification + Trigger Lineup Scraper

## Problem 1: Category Monoculture

All parlays are dominated by the `THREE_POINT_SHOOTER` category because:

1. **Sorted pool is top-heavy**: The pick pool is sorted by `compositeScore` (line 916), and THREE_POINT_SHOOTER has the highest weight (1.30) + highest hit rate (75%), so it always occupies the top of the sorted list
2. **109 of 300 sweet spots** are THREE_POINT_SHOOTER - more than any other category
3. **Per-parlay limit is too loose**: `maxCategoryUsage` allows 5 picks per category per parlay in exploration. With 3-leg parlays, ALL legs can be the same category
4. **No cross-parlay diversity**: Once a THREE_POINT_SHOOTER pick is used in one parlay, it's marked globally used, but there are 109 more to choose from

### Fix: Enforce category diversity within each parlay

The `maxCategoryUsage` values need to be tightened so parlays can't be mono-category:

| Tier | Parlay Sizes | Current maxCategoryUsage | New maxCategoryUsage |
|------|-------------|------------------------|---------------------|
| Exploration | 3-6 legs | 5 | 2 |
| Validation | 3-6 legs | 3 | 1 |
| Execution | 3-6 legs | 2 | 1 |

Setting validation/execution to 1 means every leg MUST be a different category, creating true diversification. Exploration at 2 allows some category doubling for larger parlays but prevents monoculture.

Additionally, add a **shuffle step** before pick selection: instead of always iterating the composite-score-sorted list top-down (which gives the same THREE_POINT_SHOOTER picks every time), shuffle the top candidates with a weighted random approach. This creates parlay variety while still preferring high-quality picks.

### Implementation

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. Change `maxCategoryUsage` values:
   - Exploration: 5 to 2
   - Validation: 3 to 1
   - Execution: 2 to 1

2. Add a weighted shuffle function that groups candidates by category and interleaves them, so the iteration order isn't always the same top-scoring category

3. In the parlay building loop (line 965-969), after filtering by sport, apply the category-interleave so picks from different categories alternate in the candidate list

## Problem 2: No Injury Data for Today

The lineup scraper cron jobs run at 8 AM and 4 PM ET but haven't populated data for the current date yet.

### Fix: Trigger manually

After deploying the code fix, manually invoke `firecrawl-lineup-scraper` to populate `lineup_alerts` for today so the availability gate has injury data to work with.

## Technical Details

### Changes to `bot-generate-daily-parlays/index.ts`

**Lines 54-55** - Exploration tier:
- `maxCategoryUsage: 5` to `maxCategoryUsage: 2`

**Lines 121-122** - Validation tier:
- `maxCategoryUsage: 3` to `maxCategoryUsage: 1`

**Lines 150-151** - Execution tier:
- `maxCategoryUsage: 2` to `maxCategoryUsage: 1`

**New function** - Add `interleaveByCategory()` around line 915:
```text
function interleaveByCategory(picks: EnrichedPick[]): EnrichedPick[] {
  // Group by category, keeping each group sorted by compositeScore
  const groups = new Map<string, EnrichedPick[]>();
  for (const pick of picks) {
    const cat = pick.category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(pick);
  }
  
  // Round-robin interleave: take the best pick from each category in turn
  const result: EnrichedPick[] = [];
  const iterators = [...groups.values()].map(g => ({ picks: g, index: 0 }));
  // Sort category groups by their best pick's composite score
  iterators.sort((a, b) => b.picks[0].compositeScore - a.picks[0].compositeScore);
  
  let added = true;
  while (added) {
    added = false;
    for (const iter of iterators) {
      if (iter.index < iter.picks.length) {
        result.push(iter.picks[iter.index]);
        iter.index++;
        added = true;
      }
    }
  }
  return result;
}
```

**Line 916** - Apply interleave:
- Replace: `enrichedSweetSpots.sort((a, b) => b.compositeScore - a.compositeScore);`
- With: `enrichedSweetSpots.sort((a, b) => b.compositeScore - a.compositeScore); enrichedSweetSpots = interleaveByCategory(enrichedSweetSpots);`

### Post-deploy steps

1. Deploy the updated edge function
2. Trigger `firecrawl-lineup-scraper` with `{"sport": "basketball_nba"}` to populate injury data
3. Trigger `bot-generate-daily-parlays` with `{"date": "2026-02-09"}` to regenerate with diversity
4. Verify parlays contain picks from multiple categories (THREE_POINT_SHOOTER, ROLE_PLAYER_REB, HIGH_ASSIST, VOLUME_SCORER, etc.)

