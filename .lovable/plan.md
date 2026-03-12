

## Add `/scanlines` and `/pipeline` Telegram Admin Commands

### Overview
Two new admin commands in `telegram-webhook/index.ts`:
- `/scanlines` — Triggers `detect-mispriced-lines` and then displays the results (combines `/runmispriced` trigger + `/mispriced` display in one command)
- `/pipeline` — Shows today's bot pipeline summary from `bot_daily_parlays`

### Changes

**File: `supabase/functions/telegram-webhook/index.ts`**

**1. Add `/scanlines` handler function (~40 lines)**

`handleScanLines(chatId)`:
1. Send "Scanning lines..." status message
2. Invoke `detect-mispriced-lines` edge function via internal fetch
3. Query `mispriced_lines` for today, filtering to new intelligence fields (`variance_cv`, `historical_hit_rate`, `consensus_deviation_pct`, `feedback_multiplier`) from `shooting_context`
4. Format top 15 results showing:
   - Player, prop, side, line
   - Edge %, confidence tier
   - New filters: variance CV, hit rate, consensus deviation, feedback multiplier
   - Flag lines that were dampened by any filter
5. Send formatted message to admin chat

**2. Add `/pipeline` handler function (~50 lines)**

`handlePipeline(chatId)`:
1. Query `bot_daily_parlays` for today (same as `useBotPipeline` hook)
2. Extract unique picks from legs, group by tier
3. Format summary:
   ```
   🔧 PIPELINE — Mar 12
   ━━━━━━━━━━━━━━━━━━
   24 parlays | 47 unique picks

   EXECUTION (3 parlays)
   • Strategy A — 4L +450 | 38%
   • Strategy B — 3L +280 | 42%

   EXPLORATION (5 parlays)
   ...

   Top Picks by Score:
   1. Player X — PTS O 24.5 (Score: 92, L10: 80%)
   2. Player Y — AST O 6.5 (Score: 88, L10: 75%)
   ```
4. Send to admin chat

**3. Wire commands (~line 4277)**

Add after the `/sweetspots` command:
```
if (cmd === "/scanlines") { await handleScanLines(chatId); return null; }
if (cmd === "/pipeline") { await handlePipeline(chatId); return null; }
```

**4. Update help text (~line 4217)**

Add to the Management section:
```
/scanlines — Run & view mispriced line scan
/pipeline — Today's parlay pipeline summary
```

### Testing
After deploying, invoke both commands via the edge function test tool to verify they return proper formatted messages without errors.

