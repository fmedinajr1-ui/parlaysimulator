

## Plan: Void Today's Parlays & Regenerate with Defense Mapping

### Current State
Today (2026-03-03) has **18 pending parlays** in `bot_daily_parlays`:
- 3 lottery tiers (standard, high_roller, mega_jackpot)
- 5 execution (elite_categories_v1)
- 10 execution (force_mispriced_conviction)

No sharp or heat parlays exist yet for today.

### What We'll Do

This is a **data operation only** -- no code changes needed. The matchup-first logic was already deployed in the previous message. We just need to:

1. **Void & delete today's parlays** -- Update all 18 `bot_daily_parlays` rows for today to `outcome = 'void'` with a lesson learned note, then delete them
2. **Trigger the Clean & Rebuild pipeline** via the `SlateRefreshControls` UI button, which runs the full 14-step pipeline including:
   - Clean stale props
   - Scan defensive matchups (feeds the matchup opportunity map)
   - Category analysis
   - Detect mispriced lines
   - Risk engine
   - Quality-gated generation (now with matchup-first scoring)
   - Sharp parlay builder (now with defense awareness)
   - Heat scan + build
   - Lottery scanner (with DD rules)
   - Diversity rebalance

### Execution
- Use the database insert tool to void + delete today's rows
- Invoke the pipeline edge functions sequentially to regenerate everything fresh with the new matchup-first intelligence

No file changes required -- just database operations and edge function invocations.

