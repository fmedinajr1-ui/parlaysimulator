
# Fix NCAAB Leg Serialization — Store `score_breakdown` and `projected_total`

## Confirmed Root Cause

After a full audit of the database and edge function code, here is the precise bug:

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`  
**Lines:** 3862–3876

When a team pick (spread, total, or moneyline) is serialized into a stored parlay leg, `score_breakdown` is intentionally excluded:

```typescript
legData = {
  id: teamPick.id,
  type: 'team',
  home_team: teamPick.home_team,
  away_team: teamPick.away_team,
  bet_type: teamPick.bet_type,
  side: teamPick.side,
  line: snapLine(teamPick.line, teamPick.bet_type),
  category: teamPick.category,
  american_odds: teamPick.odds,
  sharp_score: teamPick.sharp_score,
  composite_score: teamPick.compositeScore,
  outcome: 'pending',
  sport: teamPick.sport,
  // ❌ score_breakdown is MISSING here — this is where projected_total lives
};
```

Every `EnrichedTeamPick` has `score_breakdown` populated (e.g. line 3058: `score_breakdown: underBreakdown`) — containing `projected_total`, `tempo_slow`, `strong_defense`, etc. But it was never written to the stored object.

**Database confirmation:** A query against `bot_daily_parlays` for NCAAB legs on Feb 18–19 shows:
- `home_team` and `away_team` are stored correctly (e.g. `UMBC Retrievers`, `Vermont Catamounts`)
- `score_breakdown` is `null` for every single NCAAB leg

**Note:** The "team: null" observation was a display misreading. The `home_team`/`away_team` fields are there in the DB; `type: 'team'` is also stored. The true missing data is `score_breakdown` (and therefore `projected_total`).

---

## What to Fix

### 1. Add `score_breakdown` and `projected_total` to team leg serialization

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`  
**Lines:** 3862–3876

Add two fields to the `legData` object:

```typescript
legData = {
  id: teamPick.id,
  type: 'team',
  home_team: teamPick.home_team,
  away_team: teamPick.away_team,
  bet_type: teamPick.bet_type,
  side: teamPick.side,
  line: snapLine(teamPick.line, teamPick.bet_type),
  category: teamPick.category,
  american_odds: teamPick.odds,
  sharp_score: teamPick.sharp_score,
  composite_score: teamPick.compositeScore,
  outcome: 'pending',
  sport: teamPick.sport,
  score_breakdown: teamPick.score_breakdown || null,             // ✅ ADD
  projected_total: (teamPick.score_breakdown as any)?.projected_total ?? null, // ✅ ADD (NCAAB totals)
};
```

This is a one-location, two-field change in a 6231-line file.

---

## Why This Matters

- **Auditability:** Without `projected_total`, there's no way to verify whether the circuit breaker (which blocks picks with `projected_total <= 100` against lines `> 125`) was correctly applied to a stored pick. 
- **Settlement verification:** The `bot-settle-and-learn` function currently cannot verify that a pick was based on a valid projection vs a hardcoded fallback.
- **Debugging:** When a parlay loses, there's no way to look up what the engine's projected total was vs the actual sportsbook line.
- **`DayParlayDetail.tsx`:** No changes needed — `home_team`/`away_team` are already rendering correctly from stored data. The component at line 169 checks `leg.type === 'team' || (!!leg.home_team && !!leg.away_team)` which is working.

---

## Files to Change

| File | Lines | Change |
|---|---|---|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | 3862–3876 | Add `score_breakdown` and `projected_total` to team leg object |

That's the only change needed. The data already exists on `teamPick.score_breakdown` — it's simply being dropped during serialization.

---

## Technical Notes

- `score_breakdown` on an `EnrichedTeamPick` is typed as `Record<string, number> | undefined` (line 469). For NCAAB total unders, it contains keys like: `base`, `tempo_slow`, `strong_defense`, `ou_record`, `low_scoring_teams`, `projected_total`.
- `projected_total` is written by `calculateNcaabTeamCompositeScore` (line 694) and by the `team-bets-scoring-engine` (line 345 of that function).
- The `EnrichedTeamPick` interface already has `score_breakdown?: Record<string, number>` — no type changes needed.
- This fix is forward-only. Historical rows (Feb 18–19) will keep `score_breakdown: null`. Future runs will store it correctly.
- Re-deploying the edge function is automatic — no manual step needed.
