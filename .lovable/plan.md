

# Plan: FanDuel Lines in Hedge Recommendations + Hedge Accuracy Tracking

## Part 1: Use Real FanDuel Lines in Hedge Status Calculation

### Problem
Line 376-382: `calculateHedgeAction` uses `line` (from `category_sweet_spots.recommended_line`) instead of the FanDuel line already fetched at line 348 (`actualBook?.line`). The FanDuel line is only used for the tri-signal projection blend and the "Consider" note — not the actual hedge decision.

### Changes in `hedge-live-telegram-tracker/index.ts`

1. **Line 292**: Store original line separately, use FanDuel line for hedge decisions:
   ```typescript
   const originalLine = pick.recommended_line;
   const line = actualBook?.line ?? pick.actual_line ?? pick.recommended_line;
   ```
   Move this after `actualBook` is resolved (~line 348), or restructure so `line` gets reassigned.

2. **Line 376-382**: `calculateHedgeAction` already receives `line` — just ensure `line` is the FanDuel-resolved value (from change above).

3. **Add buffer % to ALL Telegram messages** (not just HEDGE ALERT/NOW):
   - After line 444, add: `📏 FD Line: ${line} | Buffer: ${bufferPct.toFixed(1)}%`
   - Calculate: `bufferPct = isOver ? ((projectedFinal - line) / line) * 100 : ((line - projectedFinal) / line) * 100`

4. **Tag line source in tracker upserts** (lines 484-494): add `line_source: actualBook ? 'fanduel' : 'sweet_spot'` and `live_book_line: actualBook?.line`

5. **Add buffer-based escalation**: If buffer is deeply negative (< -15%), force escalate to HEDGE NOW regardless of thresholds.

---

## Part 2: Hedge Accuracy Tracking & Settlement

### DB Migration — Add columns to `hedge_telegram_tracker`
```sql
ALTER TABLE hedge_telegram_tracker 
  ADD COLUMN IF NOT EXISTS actual_value numeric,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS hedge_was_correct boolean,
  ADD COLUMN IF NOT EXISTS live_book_line numeric,
  ADD COLUMN IF NOT EXISTS line_source text DEFAULT 'sweet_spot';
```

### New Edge Function: `settle-hedge-tracker/index.ts`
1. Query unsettled `hedge_telegram_tracker` rows (`outcome IS NULL`, `last_status_sent IS NOT NULL`)
2. Join against `category_sweet_spots` for `actual_value` (same pattern as `settle-hedge-snapshots`)
3. Determine hit/miss: OVER hit if actual > line, UNDER hit if actual < line
4. Set `hedge_was_correct`:
   - TRUE if LOCK/HOLD and pick hit
   - TRUE if HEDGE NOW/HEDGE ALERT and pick missed (correctly warned)
   - FALSE otherwise
5. Send accuracy summary to admin Telegram

### Telegram Accuracy Message Format
```
📊 HEDGE ACCURACY — March 19
LOCK: 79 picks, 76 hit (96.2%) ✅
HOLD: 45 picks, 38 hit (84.4%)
HEDGE NOW: 21 picks, 19 correctly flagged (90.5%) ✅
Overall accuracy: 94.1%
```

---

## Files Changed

1. **`supabase/functions/hedge-live-telegram-tracker/index.ts`** — Use FanDuel line in hedge decision, add buffer to messages, tag line source
2. **DB migration** — Add `actual_value`, `outcome`, `hedge_was_correct`, `live_book_line`, `line_source` to `hedge_telegram_tracker`
3. **New: `supabase/functions/settle-hedge-tracker/index.ts`** — Settlement + accuracy Telegram broadcast

