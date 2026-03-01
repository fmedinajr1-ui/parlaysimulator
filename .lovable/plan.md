

## Extra Plays (Admin Telegram) + Engine-Wide Outcome Tracking

### Overview
Surface high-quality picks that didn't make it into any parlay as an "Extra Plays" report sent to admin via Telegram only (not in the web UI). Additionally, add outcome tracking columns to `mispriced_lines` so all engine picks get settled, enabling standalone engine accuracy measurement.

---

### Part 1: Add Outcome Tracking to Mispriced Lines

**Database Migration** -- Add 3 columns to `mispriced_lines`:
```text
ALTER TABLE mispriced_lines ADD COLUMN outcome text DEFAULT 'pending';
ALTER TABLE mispriced_lines ADD COLUMN actual_value numeric;
ALTER TABLE mispriced_lines ADD COLUMN settled_at timestamptz;
```

**Update `supabase/functions/verify-all-engine-outcomes/index.ts`** -- Add a new verification section (after Heat parlays, before the summary logging):
- Query `mispriced_lines` where `outcome IS NULL OR outcome = 'pending'` for the last 3 days
- For each pick, look up game log by normalized player name + analysis_date
- Use `signal` (OVER/UNDER) as the side, `book_line` as the line
- Call existing `calculateActualValue` and `determineOutcome` functions
- Update the row with outcome, actual_value, settled_at
- Add a `mispriced` entry to the `results` array

---

### Part 2: Extra Plays Telegram Report (Admin Only)

**New edge function: `supabase/functions/generate-extra-plays-report/index.ts`**

This function:
1. Queries today's `category_sweet_spots` (high confidence, active picks) and `mispriced_lines` (ELITE/HIGH tier)
2. Fetches today's `bot_daily_parlays` legs JSON
3. Extracts all player_name + prop_type combos from parlay legs
4. Filters out any picks already included in parlays
5. Deduplicates across both tables
6. Sends the remaining "extra plays" to admin via `bot-send-telegram` with a new type `extra_plays_report`

**Update `supabase/functions/bot-send-telegram/index.ts`**:
- Add `'extra_plays_report'` to the `NotificationType` union
- Add `formatExtraPlaysReport(data, dateStr)` function that formats a clean admin report:
  ```text
  🎯 EXTRA PLAYS -- Mar 1
  ━━━━━━━━━━━━━━━━━━━━━
  Picks engines found but NOT in any parlay

  🔥 Mispriced Lines (3):
  • LeBron James PTS O25.5 | Edge: 18% | ELITE
  • Tatum REB O8.5 | Edge: 15% | HIGH

  💎 Sweet Spots (5):
  • Curry 3PM O4.5 | Hit: 80% | Score: 92
  ...

  📊 Total: 8 extra plays available
  ```
- This type is NOT in the broadcast list, so it stays admin-only by default

**Wire into pipeline** -- Add `generate-extra-plays-report` as a step in `engine-cascade-runner` or `data-pipeline-orchestrator` after parlay generation, or register as a `/extras` command in `telegram-webhook`.

---

### Part 3: Standalone Engine Accuracy in Existing Accuracy Report

**Update `supabase/functions/bot-send-telegram/index.ts`** -- Enhance the existing accuracy/settlement reports to include standalone engine stats:
- When formatting settlement or accuracy reports, query settled counts from `mispriced_lines` (once outcome tracking is live) and `category_sweet_spots` grouped by source
- Add a section showing per-engine standalone win rates (not just parlay-based)

Alternatively, add a `/engineaccuracy` admin command in `telegram-webhook` that queries:
- `nba_risk_engine_picks` settled outcomes
- `category_sweet_spots` settled outcomes
- `mispriced_lines` settled outcomes (new)
- Formats and sends a per-engine accuracy summary to admin

---

### Files Modified
- **Database**: `mispriced_lines` table -- add `outcome`, `actual_value`, `settled_at` columns
- **`supabase/functions/verify-all-engine-outcomes/index.ts`** -- add mispriced lines verification section
- **`supabase/functions/generate-extra-plays-report/index.ts`** -- new edge function
- **`supabase/functions/bot-send-telegram/index.ts`** -- add `extra_plays_report` type + formatter
- **`supabase/functions/telegram-webhook/index.ts`** -- add `/extras` and `/engineaccuracy` admin commands
- **`supabase/config.toml`** -- register new edge function (auto-handled)

