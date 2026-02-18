
# Fix: NCAAB Under Totals Not Building 3-Leg Parlays

## Root Cause Analysis

The database confirms there ARE valid NCAAB total under picks today. For example:
- East Tennessee St vs Furman: `composite_score: 93`, `recommended_side: UNDER` ✓
- Bradley vs Valparaiso: `composite_score: 84` ✓  
- Holy Cross vs Lafayette: `composite_score: 73`, `recommended_side: UNDER` ✓
- Coastal Carolina vs James Madison: `composite_score: 67`, `recommended_side: UNDER` ✓

These should be forming 3-leg parlays but instead the generator is falling back to 5 single-leg NCAAB spread picks. Here is exactly why:

---

## Bug 1 — The Side Filter Uses the Wrong Strategy Name (Critical)

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`, line 3477

```ts
// CURRENT (broken):
if (profile.strategy === 'ncaab_unders' && p.bet_type === 'total') {
  return (p as EnrichedTeamPick).side?.toUpperCase() === 'UNDER';
}
return true; // ← falls through here for all other strategies!
```

The profile strategies are named `ncaab_unders_only`, `validated_ncaab_unders`, `ncaab_accuracy`, and `ncaab_unders_probe`. **None of them match `'ncaab_unders'`**. So the UNDER side filter never fires. Instead, `return true` runs for everything — meaning NCAAB OVER totals pass through too (even though they're already blocked upstream). More critically, without this filter enforcing UNDERs, the picks aren't being sorted or selected as UNDER-specific candidates, which causes the builder to mix in non-under picks and fail validation.

**Fix:** Replace the exact string match with a `.includes()` check that catches all NCAAB under strategy names:

```ts
// FIXED:
const isNcaabUnderStrategy = profile.strategy.includes('ncaab_under') || 
  profile.strategy === 'ncaab_accuracy' || 
  profile.strategy === 'ncaab_unders_probe';

if (isNcaabUnderStrategy && p.bet_type === 'total') {
  return (p as EnrichedTeamPick).side?.toUpperCase() === 'UNDER';
}
```

---

## Bug 2 — Profile `side` Property Is Declared But Never Used to Filter (Critical)

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`, lines 86–214

Every NCAAB under profile declares `side: 'under'` in its config:
```ts
{ legs: 3, strategy: 'ncaab_unders_only', ..., side: 'under', ... }
{ legs: 3, strategy: 'validated_ncaab_unders', ..., side: 'under', ... }
{ legs: 3, strategy: 'ncaab_accuracy', ..., side: 'under', ... }
```

But the `isTeamProfile` filter block (line 3469–3481) **never reads `profile.side`**. It only checks `profile.betTypes`. So even if Bug 1 were fixed, a profile with `side: 'under'` gets all picks (both OVER and UNDER) when the strategy name doesn't exactly match.

**Fix:** Add a generic `profile.side` filter that works for any strategy that declares it:

```ts
} else if (isTeamProfile) {
  candidatePicks = pool.teamPicks.filter(p => {
    if (!profile.betTypes!.includes(p.bet_type)) return false;
    if (BLOCKED_SPORTS.includes(p.sport)) return false;
    if (!sportFilter.includes('all') && !sportFilter.includes(p.sport)) return false;
    // Generic: if profile declares a required side, enforce it
    if (profile.side && p.bet_type === 'total') {
      return (p as EnrichedTeamPick).side?.toLowerCase() === profile.side.toLowerCase();
    }
    return true;
  });
```

This is cleaner than the per-strategy string match and automatically handles all current and future strategy names that declare `side`.

---

## Bug 3 — `game_bets` Records from the Whale Sync Have `composite_score: null` (Secondary)

The DB query shows that many NCAAB `game_bets` rows (from the whale-signal-detector sync) have `composite_score: null` and `recommended_side: null`. These records come from the Whale Detector (`whale-signal-detector`), not from the scorer. When `buildPropPool` processes `game_bets`, if `composite_score` is null the `calculateTeamCompositeScore()` function runs — but the ML Sniper Gate at line 3098 checks `pick.compositeScore < effectiveTeamFloor`. If `compositeScore` ends up as 0 or NaN due to null input data, the pick gets blocked by the floor filter (composite 0 < 65).

However, the picks that ARE correctly scored (Holy Cross 93, East Tennessee St 93, Bradley 84) pass this gate fine. The null-score picks are a separate issue for the whale sync — the main parlay-building failure is Bugs 1 and 2.

**Fix (minor):** Add a null-guard so null composite_score from game_bets defaults to 50 instead of 0/NaN during enrichment:

In `buildPropPool` where picks are pushed:
```ts
compositeScore: clampScore(30, 95, (score ?? 50) + plusBonus + underWeatherBonus),
```

---

## Files Changed

| File | Lines | Change |
|---|---|---|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | 3476–3480 | Replace `profile.strategy === 'ncaab_unders'` with generic `profile.side` filter (fixes Bugs 1 + 2 in one shot) |

That's it — one targeted fix to the filter block. No schema changes, no new tables.

---

## What Happens After the Fix

With the side filter working:

- `ncaab_unders_only` (execution tier): gets only NCAAB total UNDERs → East Tennessee St (93), Bradley (84), Holy Cross (73) → **forms a 3-leg NCAAB under parlay**
- `validated_ncaab_unders` (validation tier): same pool → builds another 3-leg parlay  
- `ncaab_accuracy` + `ncaab_unders_probe` (exploration tier): build 2 more 3-leg NCAAB under parlays

Expected result after fix + fresh Smart Generate: **4–6 valid 3-leg NCAAB under parlays** from today's confirmed-scored picks, plus whatever team picks survive the existing NBA/NHL gates.

---

## Database Cleanup (After Deploy)

After deploying, delete today's 5 single-leg junk picks and re-run:

```sql
DELETE FROM bot_daily_parlays 
WHERE parlay_date = '2026-02-18' 
AND outcome = 'pending';
```

Then trigger Smart Generate — it will find the NCAAB under picks and build proper 3-leg parlays.
