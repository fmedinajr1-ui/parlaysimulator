

## Clean Slate & Rebuild with Customer Alert

### What This Does

Adds a "Clean & Rebuild" button to SlateRefreshControls that:

1. **Sends a Telegram alert to ALL customers** notifying them that today's parlays are being regenerated with improved defensive intelligence
2. **Voids all pending parlays for today** in the database
3. **Runs the full defense-aware pipeline** (matchup scanner -> analysis -> generation)
4. **Sends the new slate report** to customers once complete

### Changes

**File: `src/components/market/SlateRefreshControls.tsx`**

Add a new `CLEAN_REBUILD_STEPS` array and `handleCleanAndRebuild` function:

1. Add state: `isRebuilding`, `rebuildStep`, `rebuildSteps`
2. Define `CLEAN_REBUILD_STEPS`:
   - Step 1: "Alerting customers" -- calls `bot-send-telegram` with a new type `slate_rebuild_alert` that broadcasts to all customers
   - Step 2: "Voiding old parlays" -- inline DB update: `bot_daily_parlays` where `parlay_date = today` and `outcome = pending/null` -> set `outcome = 'void'`, `lesson_learned = 'Voided for defense-aware rebuild'`
   - Step 3: "Cleaning stale props" -- `cleanup-stale-props`
   - Step 4: "Scanning defensive matchups" -- `bot-matchup-defense-scanner`
   - Step 5: "Analyzing categories" -- `category-props-analyzer`
   - Step 6: "Detecting mispriced lines" -- `detect-mispriced-lines`
   - Step 7: "Running risk engine" -- `nba-player-prop-risk-engine`
   - Step 8: "Generating defense-aware parlays" -- `bot-generate-daily-parlays`
   - Step 9: "Building sharp parlays" -- `sharp-parlay-builder`
   - Step 10: "Building heat parlays" -- `heat-prop-engine`
3. Add a "Clean & Rebuild" button (destructive variant, with a Zap icon) next to the existing "Refresh All Engines" button
4. After all steps complete, invalidate all queries

The `getEasternDate()` helper will format today's date in `YYYY-MM-DD` for the void query.

**File: `supabase/functions/bot-send-telegram/index.ts`**

1. Add `'slate_rebuild_alert'` to the `NotificationType` union
2. Add a `formatSlateRebuildAlert` function that produces a message like:

```text
🔄 SLATE UPDATE — Feb 24

We're regenerating today's parlays with upgraded defensive intelligence.

What's new:
• Per-stat defense matchup analysis (points, 3PT, rebounds, assists)
• Weak opponent targeting — focusing on exploitable matchups
• Tighter exposure controls

New picks will be sent shortly. Stay tuned! 🎯
```

3. Add `'slate_rebuild_alert'` to the broadcast list (line 1027) alongside `mega_parlay_scanner` and `daily_winners_recap` so it goes to ALL active customers, bypassing quiet hours

### Summary

| Change | What it does |
|---|---|
| New "Clean & Rebuild" button | Voids today's parlays, runs full defense-aware pipeline from scratch |
| Customer Telegram alert | Broadcasts a notification to all active customers that parlays are being regenerated |
| 10-step pipeline | Matchup scanner runs first, then analysis, then generation with defense gates active |
| Auto-refresh UI | Invalidates all query caches so dashboard shows fresh slate immediately |

