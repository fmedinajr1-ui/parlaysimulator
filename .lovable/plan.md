
# Fix: Mini Parlay Flood + Monster Parlay Gate + Archetype Priority

## What's Actually Happening Today

### Problem 1: Mini Parlay Flood (39 of 47 parlays are 2-leg)
The mini-parlay fallback in `bot-generate-daily-parlays` triggers when `allParlays.length < 12`. Today, only 8 standard (3-4 leg) parlays were built before the monster parlay check, so the fallback ran and created 39 mini-parlays. The threshold of `< 12` is too low — it lets the system dump the board with low-value 2-leggers instead of enforcing quality.

**Fix:** Raise the mini-parlay fallback threshold from `< 12` to `< 6`. Mini-parlays should only exist as a last resort on truly thin slates, not fill in whenever the 3+ leg builder doesn't hit 12.

Additionally, cap mini-parlay total output more aggressively: currently `MAX_MINI_PARLAYS` is 24 (exploration) and 16 validation. Reduce to 8 exploration and 5 validation maximum.

### Problem 2: Monster Parlay Not Triggering
The monster parlay gate requires **15+ quality candidates across 2+ sports**. Today only NBA + NCAAB are available (2 sports ✓), but the candidate filter is very strict: hit_rate >= 55%, composite >= 60, AND catWeight >= 0.5. With only a 2-sport day, it's likely sitting at 10-14 candidates — just under the 15 threshold.

**Fix:** Lower the monster parlay candidate floor from `15` to `10` on days with exactly 2 sports, making the gate: `qualityCandidates.length >= 10 && activeSports.size >= 2`. On 3+ sport days keep the 15 minimum. This gives monster parlays a realistic chance on normal NBA+NCAAB days.

### Problem 3: Wrong Archetypes Being Used at Scale
Today's data shows `BIG_REBOUNDER over` (56.9% hit rate) appears in 33 of 47 parlays. Meanwhile the highest hit-rate archetypes are barely used:

| Archetype | Hit Rate | Picks |
|---|---|---|
| BIG_REBOUNDER under | 100% | 9 |
| LOW_LINE_REBOUNDER under | 100% | 7 |
| THREE_POINT_SHOOTER over | 75.3% | 214 |
| HIGH_ASSIST_UNDER | 75% | 12 |

The mini-parlay fallback sorts candidates by `compositeScore` (not hit rate), so it ranks BIG_REBOUNDER heavily due to its high weight and volume availability, even though the under version of that archetype has 100% hit rate. The main tiered generator already uses accuracy-first sorting — but the mini-parlay fallback doesn't match this.

**Fix:** In the mini-parlay fallback candidate sort, switch from pure `compositeScore` to `hit_rate DESC, compositeScore DESC` — matching the same accuracy-first sorting already enforced in the monster parlay generator. Also enforce that UNDER-side archetypes with `catWeight > 1.0` get a priority boost to surface `BIG_REBOUNDER under`, `LOW_LINE_REBOUNDER under`, and `HIGH_ASSIST_UNDER` first.

---

## Files Being Changed

### File 1: `supabase/functions/bot-generate-daily-parlays/index.ts` (3 targeted edits)

**Edit A — Mini-parlay fallback threshold (line ~5027):**
Change:
```ts
if (allParlays.length < 12) {
```
To:
```ts
if (allParlays.length < 6) {
```

**Edit B — Mini-parlay cap reduction (line ~5119):**
Change:
```ts
const MAX_MINI_PARLAYS = isLightSlateMode ? 24 : 16;
```
To:
```ts
const MAX_MINI_PARLAYS = isLightSlateMode ? 10 : 6;
```

**Edit C — Mini-parlay candidate sort (line ~5082):**
Change from pure composite sort to hit-rate-first:
```ts
.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
```
To:
```ts
.sort((a, b) => {
  const hrA = ((a.confidence_score || a.l10_hit_rate || 0) * 100);
  const hrB = ((b.confidence_score || b.l10_hit_rate || 0) * 100);
  if (hrB !== hrA) return hrB - hrA; // Hit-rate first
  return (b.compositeScore || 0) - (a.compositeScore || 0); // Then composite
});
```

**Edit D — Monster parlay gate (line ~4277):**
Change the fixed `15` threshold to sport-aware:
```ts
if (qualityCandidates.length < 15 || activeSports.size < 2) {
```
To:
```ts
const monsterMinCandidates = activeSports.size >= 3 ? 15 : 10;
if (qualityCandidates.length < monsterMinCandidates || activeSports.size < 2) {
```

---

## What This Achieves

- Mini parlays only appear when the bot truly has fewer than 6 real parlays (was 12), and are capped at 6 total (was 16-24)
- Monster parlays now fire on standard NBA + NCAAB days when 10+ quality candidates exist
- The highest hit-rate archetypes (THREE_POINT_SHOOTER 75%, HIGH_ASSIST_UNDER 75%, BIG_REBOUNDER under 100%) get sorted to the top of the mini-parlay pool if mini-parlays do run
- No schema changes, no new dependencies — all changes are contained to one function

---

## Technical Notes

- All 4 edits are in `supabase/functions/bot-generate-daily-parlays/index.ts`
- The function will be redeployed automatically after edits
- Today's board can be refreshed via "Refresh All Engines" button in the Dashboard to see the new parlay composition immediately
- `BIG_REBOUNDER over` (56.9%) will still appear but no longer dominate — it will be outranked by `THREE_POINT_SHOOTER over` (75.3%) and UNDER-side archetypes in sorting priority
