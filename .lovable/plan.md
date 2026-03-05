

# Tighten Ladder Challenge + Fresh Data + Regenerate Today

## Changes to `supabase/functions/nba-ladder-challenge/index.ts`

### A. Force fresh game log data before picking
After the dedup check (line 126), add a call to `nba-stats-fetcher` with `{ mode: 'sync', daysBack: 3, useESPN: true, includeParlayPlayers: true }` so L10 data is never stale when the lock is selected.

### B. Stricter safety gates (lines 260-273)
1. Minimum L10 games: `5` → `8`
2. Minimum hit rate: `0.8` → `0.9`
3. **Hard floor rule**: `if (min <= lineObj.line) continue` — worst L10 game must CLEAR the line
4. **Median clearance**: `if (median < lineObj.line + 1) continue` — median must beat line by 1+

### C. New "Safety Score" replaces composite score (lines 321-327)
Reweight to prioritize safety:
- Hit Rate: 50% (was 40%)
- Floor Protection: 25% (was 20%)
- Edge: 15% (was 20%)
- Consistency: 10% (same)

Rename `composite_score` → `safety_score` throughout and include breakdown in the Telegram message.

### D. Update Telegram message (lines 420-430)
Show the new safety score breakdown: floor margin, hit rate fraction, edge, and the new score name.

### E. Update log messages
Change "80%+" references to "90%+" and "composite" to "safety".

## After deployment
Invoke the function manually to regenerate today's pick with fresh data and tightened filters. If no pick qualifies under the stricter criteria, that's the correct outcome — we skip the day rather than force a weak pick.

## Files changed
1. `supabase/functions/nba-ladder-challenge/index.ts` — all changes above

