

## Daily Double-Confirmed Picks Report

### What Are Double-Confirmed Picks?

Picks that appear in BOTH:
- `category_sweet_spots` (70%+ historical L10 hit rate)
- `mispriced_lines` (15%+ statistical edge vs book line)

These are currently only identified inside `bot-generate-daily-parlays` during parlay generation. There's no standalone detection or Telegram report for them.

### Plan

**Step 1: Create `double-confirmed-scanner` edge function** (NEW)

File: `supabase/functions/double-confirmed-scanner/index.ts`

A lightweight standalone function that:
1. Fetches today's `category_sweet_spots` (L10 hit rate, side, player, prop type)
2. Fetches today's `mispriced_lines` (edge_pct, signal, player, prop type)
3. Cross-references by normalized `player_name|prop_type`
4. Filters for direction agreement (both say OVER or both say UNDER)
5. Qualifies picks with: hit rate >= 70% AND edge >= 15%
6. Sends a Telegram report via `bot-send-telegram` with type `double_confirmed_report`
7. Returns the list of double-confirmed picks in the response

---

**Step 2: Add `double_confirmed_report` format to `bot-send-telegram`**

File: `supabase/functions/bot-send-telegram/index.ts`

Add a new report type matching the screenshot format:
```
 N Double-Confirmed Picks Found:

 - Player Name  PropType SIDE -- XX% L10, +YY% edge
 - Player Name  PropType SIDE -- XX% L10, +YY% edge
 ...
```

- Add `'double_confirmed_report'` to the `NotificationType` union
- Add `formatDoubleConfirmedReport` function
- Wire it into the `formatMessage` switch
- Add to the bypass list (always sends, like high conviction reports)

---

**Step 3: Wire into pipeline orchestrator**

File: `supabase/functions/data-pipeline-orchestrator/index.ts`

- Add `double-confirmed-scanner` call in Phase 2 (Analysis), after `detect-mispriced-lines` and sweet spot analysis have both completed
- This ensures both data sources are fresh before cross-referencing

---

**Step 4: Add Telegram command**

File: `supabase/functions/telegram-webhook/index.ts`

- Add `/doubleconfirmed` command to trigger the scanner on demand
- Add `/rundoubleconfirmed` to re-run the full scan

---

### Technical Details

**Scanner cross-reference logic:**
```text
1. Fetch category_sweet_spots where analysis_date = today
2. Fetch mispriced_lines where analysis_date = today
3. Build sweet spot map: key = lowercase(player_name)|normalized(prop_type)
4. For each mispriced line:
   a. Look up in sweet spot map
   b. Check direction agreement (mispriced signal matches sweet spot side)
   c. If hit_rate >= 70% AND abs(edge_pct) >= 15%: mark as double-confirmed
5. Sort by composite score (edge * hit_rate weighting)
6. Send Telegram report
```

**Telegram format (matching screenshot):**
```text
 X Double-Confirmed Picks Found:

 - Collin Gillespie  Threes OVER -- 100% L10, +36% edge
 - Desmond Bane  Threes OVER -- 100% L10, +24% edge
 ...

Date | Sport breakdown | Total sweet spots: N | Total mispriced: N
```

### Files Modified

1. `supabase/functions/double-confirmed-scanner/index.ts` -- NEW: standalone scanner
2. `supabase/functions/bot-send-telegram/index.ts` -- Add `double_confirmed_report` format
3. `supabase/functions/data-pipeline-orchestrator/index.ts` -- Wire scanner into Phase 2
4. `supabase/functions/telegram-webhook/index.ts` -- Add `/doubleconfirmed` command

### Expected Outcome

- Daily automated Telegram report showing all double-confirmed picks (matching screenshot format)
- On-demand `/doubleconfirmed` command in Telegram
- Runs automatically in the pipeline after mispriced lines and sweet spots are fresh
