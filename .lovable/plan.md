

## Reinstall Winning Strategy + Fix High Void Rate

### Investigation Findings

**Performance Feb 20-23:**
| Date | Total | Won | Lost | Void | Win Rate | Net P&L |
|------|-------|-----|------|------|----------|---------|
| Feb 20 | 51 | 10 | 36 | 5 (10%) | 21.7% | +$7,724 |
| Feb 21 | 29 | 10 | 17 | 2 (7%) | 37.0% | +$2,699 |
| Feb 22 | 31 | 6 | 3 | 22 (71%) | 66.7% | +$3,907 |
| Feb 23 | 97 | 45 | 38 | 14 (14%) | 54.2% | +$12,353 |
| **Feb 24** | **39** | **1** | **13** | **25 (64%)** | **7.1%** | **-$928** |

**Top winning strategy:** `elite_categories_v1_exploration_mispriced_edge` -- 55.6% WR, +$10,308 profit, 35 wins in 63 settled parlays.

### Three Root Causes of High Void Rate

1. **Premature void on missing game logs** -- Settlement runs at ~11 PM ET but game logs for West Coast games may not be ingested until later. When fallback 2 finds no game log, it permanently marks the leg `void`. Once more than half the legs are void, the whole parlay is voided and never re-checked.

2. **Name mismatches in settlement** -- Players like "Carlton Carrington" are stored as "Bub Carrington" in game logs. The ILIKE search fails completely. On Feb 22, 8 OG Anunoby parlays were voided because settlement ran before his game log was ingested (he played and had 9pts/9reb/2ast).

3. **Wrong strategy selected** -- The generator queries `bot_strategies` with `.limit(1).single()` and gets `strong_cash` (first alphabetically). The winning `elite_categories_v1` strategy (84 wins total) is in the table but not being selected.

### Plan

#### Step 1: Fix settlement to NOT prematurely void legs

**File:** `supabase/functions/bot-settle-and-learn/index.ts`

- Change fallback 2 behavior: when no game log is found, keep leg as `pending` instead of `void`
- Only mark as `void` if the game date is 2+ days old (giving time for game log ingestion)
- Add a staleness check: `if parlay_date is more than 48 hours ago AND still no game log -> void`

```text
Current (line 782-785):
  } else {
    legOutcome = 'void';
  }

New:
  } else {
    // Don't void immediately - game logs may not be ingested yet
    const parlayAge = Date.now() - new Date(parlay.parlay_date + 'T23:59:00-05:00').getTime();
    const hoursOld = parlayAge / (1000 * 60 * 60);
    if (hoursOld > 48) {
      legOutcome = 'void'; // Game was 2+ days ago, truly DNP
    } else {
      legOutcome = 'pending'; // Keep pending for retry
    }
  }
```

#### Step 2: Add player name alias map for settlement

**File:** `supabase/functions/bot-settle-and-learn/index.ts`

Add a name alias dictionary at the top of the file so that known mismatches are handled:

```text
const NAME_ALIASES: Record<string, string[]> = {
  'carlton carrington': ['bub carrington'],
  'bub carrington': ['carlton carrington'],
  'nic claxton': ['nicolas claxton'],
  'nicolas claxton': ['nic claxton'],
  // Add more as discovered
};
```

Modify fallback 2 game log lookup to also try aliases:
- After the primary ILIKE fails, check if normalizedName has aliases
- Try each alias with ILIKE query
- This prevents permanent void for name-mismatch players

#### Step 3: Re-settle previously voided parlays

**File:** `supabase/functions/bot-settle-and-learn/index.ts`

Add logic at the start of settlement to also re-process voided parlays that have pending legs:
- Query parlays where `outcome = 'void'` but legs still contain `pending` outcomes
- Re-run them through the settlement pipeline
- This recovers parlays that were prematurely voided

#### Step 4: Reinstall `elite_categories_v1` as primary strategy

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Change the strategy selection query to prefer `elite_categories_v1` explicitly:
- Instead of `.limit(1).single()`, query for `elite_categories_v1` first
- Fallback to any active strategy if not found
- This ensures the +$10,308 winning formula is used

#### Step 5: Add pre-generation void prevention

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Before generating parlays, cross-reference selected players against today's injury report and starting lineups:
- Skip players who are OUT/DNP on the injury list
- Skip players who don't appear in any lineup data for today
- This prevents generating parlays with legs that will inevitably void

### Files Modified
- `supabase/functions/bot-settle-and-learn/index.ts` -- Fix premature voiding, add name aliases, re-settle voided parlays
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- Use elite_categories_v1 strategy, add pre-generation DNP filtering

### Expected Impact
- Void rate should drop from 60-70% to under 15%
- Win rate should improve by reinstalling the proven strategy
- Previously voided parlays with valid data will be recovered and settled correctly

