
## Fix Mispriced Edge Flooding and Void Loop

### Problem
Today's slate shows 72% of all parlays are mispriced-related, and 70% of all parlays get voided. The promotion system and force-fresh parlays are duplicating the same strategy type, and the quality loop is generating parlays that get voided on the next cycle.

### Root Causes
1. `bot-force-fresh-parlays` generates mispriced parlays without checking what the main loop already created
2. `bot-quality-regen-loop` may be re-running and voiding its own previous output
3. No strategy diversity cap -- mispriced edge can consume the entire slate
4. The promotion system adds more mispriced profiles to execution tier, compounding the flood

### Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **Add strategy diversity cap**: Before generating parlays for any strategy, check how many already exist for today with that strategy name. Cap any single strategy at 30% of the tier's total count (e.g., if execution allows 15 parlays, max 5 can be mispriced_edge_promoted).

2. **Reduce promoted profile cap from 8 to 4**: In `autoPromoteToExecution`, lower the maximum promoted profiles from 8 to 4 to prevent mispriced domination of the execution tier.

**File: `supabase/functions/bot-force-fresh-parlays/index.ts`**

3. **Skip if mispriced parlays already exist**: At the start of the function, query today's `bot_daily_parlays` for `strategy_name LIKE '%mispriced%'` with outcome = 'pending'. If 10+ mispriced parlays already exist and are active, skip generation and log "Sufficient mispriced parlays already active, skipping force-fresh."

4. **Cap force-fresh output to 10 max**: Even when generating, limit the batch to 10 parlays instead of flooding with 17+.

**File: `supabase/functions/bot-quality-regen-loop/index.ts`**

5. **Don't void on re-run within same day**: Before voiding existing parlays, check if the current run is a retry within the same generation window (same day, same trigger). If pending parlays from the current day already exist and haven't been settled, skip the void step and only generate additional parlays to fill gaps.

6. **Track generation runs**: Add a simple check -- query `bot_daily_parlays` for today's date. If parlays with outcome='pending' already exist from the current day, set a `is_supplemental = true` flag that skips the void step.

### Expected Result
- Strategy diversity: No single strategy exceeds ~30% of output
- Void rate drops from 70% to near 0% (no self-voiding within the day)
- Force-fresh becomes additive only when needed, not duplicative
- Active parlay count should be 60-80 instead of 29 survivors out of 97
