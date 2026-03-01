

## Enable Alt Lines on High-Frequency Strategies

### Problem
The `force_mispriced_conviction` (from `bot-force-fresh-parlays`) and `mispriced_edge` / `double_confirmed_conviction` profiles in the execution tier (from `bot-generate-daily-parlays`) fire most often but have `useAltLines: false` or no alt line setting. Only `boosted_cash`, `golden_lock`, and `role_stacked_3leg` profiles currently shop for alternate lines, and those don't always fire.

### Changes

#### 1. Enable alt lines on execution tier profiles in `bot-generate-daily-parlays`

Update the following execution tier profiles (lines ~907-921) to add `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`:

- `mispriced_edge` profiles (6 entries in execution) -- enable alt lines on 3 of them (keep 3 without for diversity)
- `double_confirmed_conviction` profiles (4 entries in execution) -- enable alt lines on 2 of them

Specifically:
```text
BEFORE:
  { legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 55, sortBy: 'composite' }
  { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate' }
  { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 62, sortBy: 'composite' }
  { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 65, sortBy: 'composite' }
  { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate' }

AFTER (add useAltLines + boostLegs + minBufferMultiplier):
  { ..., useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 }
```

This is a safe 1-leg cap with a 1.5x buffer requirement, matching the proven `boosted_cash` configuration.

#### 2. Add alt line shopping to `bot-force-fresh-parlays`

After scoring and sorting picks (Step 3, ~line 258), add a new section that:
1. Filters the top 10 NBA picks that have sufficient projection buffer (player_avg_l10 vs book_line)
2. Calls `fetch-alternate-lines` for each qualifying pick
3. Stores alternate lines on the pick object
4. During parlay assembly (Step 4), for the first leg in each parlay, if alt lines exist and a lower line has favorable odds (over -200), substitute it -- applying the same `boostLegs: 1` safety cap

This mirrors the alt line logic already in `bot-generate-daily-parlays` (lines 4388-4446) but adapted for the force-fresh flow.

### Technical Details

**Files modified:**
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- Toggle `useAltLines: true` on 5 execution-tier profiles (lines ~907-932)
- `supabase/functions/bot-force-fresh-parlays/index.ts` -- Add alt line fetch section (~30 lines after line 258) and alt line substitution in parlay assembly (~15 lines in the loop at line 270)

**Safety guardrails (already built into the system):**
- `boostLegs: 1` caps alt line usage to 1 leg per parlay
- `minBufferMultiplier: 1.5` ensures the player's projection is at least 1.5x above the minimum buffer before alt lines activate
- Alt line odds floor of -200 prevents taking heavily juiced lines
- No changes to exploration or validation tiers

