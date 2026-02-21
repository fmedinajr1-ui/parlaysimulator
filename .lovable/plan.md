

## Regenerate Today's Parlays with Double-Confirmed Engine

### What Needs to Happen

The 11 existing parlays for Feb 21 were generated before the cross-referencing logic was deployed. To see the new double-confirmed picks (Gillespie, Bane, Allen, etc.), we need to:

1. **Clear today's existing parlays** from `bot_daily_parlays` so the engine generates fresh ones
2. **Invoke the generation engine** (`bot-generate-daily-parlays`) which now includes the direction-conflict filter and double-confirmed cross-referencing
3. **Invalidate frontend caches** so the UI shows the new parlays immediately

### Steps

**Step 1: Delete today's stale parlays**

Run a SQL delete on `bot_daily_parlays` where `parlay_date = '2025-02-21'` to remove the 11 old parlays that lack cross-referencing.

**Step 2: Invoke the generation edge function**

Call `bot-generate-daily-parlays` directly using the edge function curl tool. This will:
- Build the sweet spot lookup map with normalized prop types
- Cross-reference every mispriced line against sweet spots
- Apply the direction-conflict filter (blocking picks like Josh Giddey where sides disagree)
- Grant +20 bonus to true double-confirmed picks (sides agree, 70%+ hit rate, 15%+ edge)
- Build parlays using the new `double_confirmed_conviction` strategy alongside existing strategies

**Step 3: Verify results**

Query the database to confirm new parlays were generated with `has_double_confirmed = true` and that the `double_confirmed_conviction` strategy appears in the results.

### Expected Output

New parlays featuring double-confirmed picks like:
- Collin Gillespie Threes OVER (100% L10, +36% edge)
- Desmond Bane Threes OVER (100% L10, +24% edge)
- Grayson Allen Points OVER (80% L10, +33% edge)
- Ty Jerome Points OVER (80% L10, +27% edge)

Direction conflicts like Josh Giddey will be logged but excluded from the double-confirmed pool.

