
# Restore NCAAB Total Unders — Surgical Block Instead of Full Ban

## What the Data Actually Shows

The database `bot_category_weights` table reveals a critical distinction that was missed in the blanket NCAAB ban:

| NCAAB Category | Hit Rate | Bayesian Rate | Status |
|---|---|---|---|
| UNDER_TOTAL (unders) | **70.6%** (12/17) | 59.46% | NOT blocked, weight 1.20 |
| OVER_TOTAL (overs) | 29.4% (5/17) | 40.54% | Auto-blocked ✅ |
| Spread / Moneyline | All voiding | — | Need to block |

The full NCAAB ban we just deployed throws away the **best-performing team total category in the entire bot**. NCAAB unders are hitting at 70.6% — higher than any NBA category currently.

The problem was never "NCAAB unders". The problem was NCAAB spreads, overs, and moneylines that generate void settlements.

## What Needs to Change

### Change 1 — Add one targeted NCAAB unders-only execution profile back

In `supabase/functions/bot-generate-daily-parlays/index.ts`, add back a **single** NCAAB execution profile that is strictly limited to totals/under side only:

```typescript
// ADD back to execution.profiles — NCAAB unders only, NOT spreads or overs:
{ 
  legs: 3, 
  strategy: 'ncaab_unders_only', 
  sports: ['basketball_ncaab'], 
  betTypes: ['total'], 
  side: 'under',           // <-- under side only
  minHitRate: 62,          // floor above the 59.46% bayesian rate
  sortBy: 'hit_rate', 
  useAltLines: false 
},
```

This is one profile replacing one of the 5 NBA profiles added — keeping total NBA profile count at 9 (the original 5 core + 4 new NBA profiles + 1 NCAAB under-only).

### Change 2 — Add NCAAB unders back to validation tier (1 profile only)

Similarly restore one NCAAB under-only profile to validation:

```typescript
// ADD back to validation.profiles — 1 profile, under side only:
{ 
  legs: 3, 
  strategy: 'validated_ncaab_unders', 
  sports: ['basketball_ncaab'], 
  betTypes: ['total'], 
  side: 'under',           // <-- under side only
  minOddsValue: 45, 
  minHitRate: 62 
},
```

### Change 3 — Add NCAAB under side filter in the mini-parlay leg builder

The mini-parlay fallback picks team game bets from a pool. NCAAB unders should be allowed there but NCAAB overs and spreads should not. In the mini-parlay leg filter added previously:

```typescript
// Current (blocks ALL NCAAB):
const eligibleMiniLegs = allTeamPicks.filter(pick => 
  pick.sport !== 'basketball_ncaab' && pick.sport !== 'baseball_ncaa'
);

// Replace with (only blocks NCAAB overs + spreads):
const eligibleMiniLegs = allTeamPicks.filter(pick => {
  if (pick.sport === 'basketball_ncaab') {
    // Only allow NCAAB unders (total, under side) — no spreads, no overs
    return pick.bet_type === 'total' && pick.side === 'under';
  }
  if (pick.sport === 'baseball_ncaa') return false;
  return true;
});
```

### Change 4 — Keep NCAAB unders in exploration (restore 2 profiles)

In the exploration tier, restore the NCAAB under profiles that were trimmed. These are low-stake test runs that confirm the under edge is consistent:

```typescript
// ADD back to exploration.profiles:
{ legs: 3, strategy: 'ncaab_accuracy', sports: ['basketball_ncaab'], betTypes: ['total'], side: 'under', minHitRate: 60, sortBy: 'hit_rate' },
{ legs: 3, strategy: 'ncaab_unders_probe', sports: ['basketball_ncaab'], betTypes: ['total'], side: 'under', minHitRate: 58, sortBy: 'composite' },
```

## Files to Change

**1 file: `supabase/functions/bot-generate-daily-parlays/index.ts`**

- Execution profiles: Add 1 NCAAB under-only profile back (replaces 1 of the 5 added NBA profiles, leaving 4 new NBA + original 5 + 1 NCAAB under)
- Validation profiles: Restore 1 NCAAB under-only profile  
- Exploration profiles: Restore 2 NCAAB under-only profiles (trimmed too aggressively)
- Mini-parlay leg filter: Change from `sport !== 'basketball_ncaab'` to allow NCAAB under totals only

Redeploy the edge function after changes.

## Why This Is the Right Call

The `bot_category_weights` auto-calibrator already blocked NCAAB overs (29.4% → auto-blocked). The system correctly identified the bad half of NCAAB. The human intervention (blanket ban) was too broad — it removed a 70.6% hit-rate category from the engine.

Keeping NCAAB unders in execution at $100 with a 70.6% hit rate is correct bankroll deployment. Removing them was leaving money on the table.

## Expected Outcome

| Category | Before Fix | After Fix |
|---|---|---|
| NCAAB unders (70.6% hit rate) | Blocked | Active in execution, validation, exploration |
| NCAAB overs (29.4% hit rate) | Auto-blocked by calibrator | Remains blocked by calibrator |
| NCAAB spreads/moneylines (voids) | Blocked | Remain blocked |
| NBA 3-leg parlays | 4 new profiles | Still 4 new NBA profiles (one swapped for NCAAB under) |
