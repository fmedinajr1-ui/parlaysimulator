

# Investigation: Why Parlays Aren't Generating

## Root Cause Found

The `bot-generate-daily-parlays` function **runs but produces 0 parlays** because the pick pool is too small to survive the layered filters.

### Evidence from today's logs:
1. **Pool**: Only **62 player props**, 0 mispriced, 0 double-confirmed, 0 triple-confirmed, 0 multi-engine
2. **Every strategy fails** to build enough legs:
   - `only 1/3 legs built from 5 candidates`
   - `only 2/5 legs built from 6 candidates`
   - `only 0 picks + all fallbacks exhausted`
3. **Quality regen loop**: 3 attempts, all produced **0 parlays**
4. **Sharp builder**: Only built 2-leg parlays (rejected for <3 legs)
5. **Force fresh**: 0 mispriced elite/high picks available

### Why the pool is so small (62 picks from 2,310 props):
- `GameSchedule` filter removes 173 of 235 enriched players (teams not playing today)
- `CASH_LOCK_FLIP_MAP` forces specific sides, blocking picks on the wrong side
- `BLOCKED_CATEGORIES` removes OVER_TOTAL, UNDER_TOTAL, BIG_ASSIST_OVER, etc.
- `GlobalGate` blocks picks that hit the slate exposure cap (max 3 per player+prop+side)
- Within parlays: `PropTypeCap` (40%), `maxTeamUsage` (2-3), `maxCategoryUsage` (2-3), `GodModeMatchup` blocks, `GrindOverBlock`, golden gate (50% golden legs required) — all compound to make 3-leg assembly impossible with only 62 candidates

### Why this worked before but not now:
- The `unified_props` table only has data from **today** (all 2,310 rows created at 14:03 UTC today). Historical data appears to get wiped/overwritten during scraping.
- The 62-pick sweet spot pool is the bottleneck — with 8 NBA games today, there should be enough data, but the enrichment/filtering pipeline is too aggressive for this slate size.

## Proposed Fix

### Immediate: Relax filters when pool is thin (< 100 picks)

In `bot-generate-daily-parlays/index.ts`, add a "thin pool" mode that activates when `enrichedSweetSpots.length < 100`:

1. **Lower the 3-leg fallback threshold** from `pool.playerPicks.length < 60` to `< 100` (line ~8281) — currently 62 picks barely misses the 60 threshold so 3-leg fallbacks aren't accepted
2. **Disable golden gate** for thin pools (line ~8303) — requiring 50% golden category legs with few picks is too restrictive
3. **Relax PropTypeCap** from 40% to 60% in thin pool mode — allow 2 of the same prop type in a 3-leg parlay
4. **Temporarily unblock `UNDER_TOTAL`** category when pool < 80 — it has 18% hit rate which is low but better than 0 parlays
5. **Lower `maxCategoryUsage`** minimum from 2 to 3 for exploration tier in thin pool mode

### Permanent: Improve pool enrichment
6. **Widen sweet spot loading** — ensure `category_sweet_spots` query pulls all players on today's teams, not just those with strong L3/L5 scores

### Files to edit:
- `supabase/functions/bot-generate-daily-parlays/index.ts` — add thin-pool relaxation logic at pool build (~line 6590) and parlay assembly (~lines 8280-8310)

