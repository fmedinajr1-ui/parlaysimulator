

## Upgrade Clean & Rebuild + Add Lottery Parlay Scanner

### What This Does

Updates the "Clean & Rebuild" flow to use the new quality-gated regeneration loop (with mispriced edge promotion) and adds the Daily Lottery Parlay Scanner as the final step so lottery parlays are always generated alongside the main slate.

### Changes

**Modified File: `src/components/market/SlateRefreshControls.tsx`**

Update the `CLEAN_REBUILD_STEPS` array:

1. Replace the direct `bot-generate-daily-parlays` call (step 8) with `bot-quality-regen-loop` -- this triggers the quality-gated loop that auto-promotes winning mispriced patterns and retries up to 3x until the 60% projected hit rate is met.
2. Add `bot-force-fresh-parlays` after the quality loop to layer on mispriced conviction parlays.
3. Add `nba-mega-parlay-scanner` as the final step to generate the lottery parlays that nearly won yesterday.
4. Update the completion toast to mention lottery parlays.

The updated step list becomes:
```text
1. Alert customers (Telegram)
2. Void old parlays
3. Clean stale props
4. Scan defensive matchups
5. Analyze categories
6. Detect mispriced lines
7. Run risk engine
8. Quality-gated generation (bot-quality-regen-loop) <-- was bot-generate-daily-parlays
9. Force fresh mispriced parlays (bot-force-fresh-parlays) <-- NEW
10. Build sharp parlays
11. Build heat parlays
12. Scan lottery parlays (nba-mega-parlay-scanner) <-- NEW
```

**Modified File: `supabase/functions/data-pipeline-orchestrator/index.ts`**

Add `nba-mega-parlay-scanner` to the end of Phase 3 (Generation) so the lottery scanner runs automatically on every scheduled pipeline execution too -- not just manual rebuilds.

### Why

- The Clean & Rebuild was still calling the old direct generation, bypassing the quality loop and mispriced promotion system you just added.
- The lottery parlay scanner was only running on its own schedule, not as part of rebuilds -- so manual rebuilds missed it.
- Yesterday's lottery parlay almost hit, so having it always run after fresh generation ensures you always get those high-upside plays with the freshest data.

