

## Fix Mispriced Lines & High Conviction Reports -- Add Expansion + Pagination Like /parlays

### Problem

The `/mispriced` and `/highconv` Telegram commands currently just trigger the edge function and dump a raw JSON summary. The detailed reports sent by `bot-send-telegram` are flat text walls with no interactive expansion -- unlike `/parlays` which has paginated display with full leg breakdowns.

### Solution

Create dedicated `handleMispriced` and `handleHighConv` command handlers in `telegram-webhook/index.ts` that query the database directly (like `handleParlays` does) and display results with:
- Paginated lists (10 per page) with Prev/Next inline buttons
- Grouped by tier (ELITE / HIGH / MEDIUM)
- Each entry shows player, prop, edge, and engine agreement
- Inline "Detail" buttons to expand individual plays with full breakdown

Also update `bot-send-telegram` report formatters to use tier-grouped sections with `+N more` cutoffs instead of dumping everything.

### Changes

**File: `supabase/functions/telegram-webhook/index.ts`**

1. **New `handleMispriced(chatId, page)` function** (~60 lines)
   - Queries `mispriced_lines` table for today's date
   - Groups by confidence tier (ELITE, HIGH, MEDIUM)
   - Shows 10 per page with formatted rows: `icon player -- prop side line | L10: avg | Edge: X%`
   - Pagination buttons: `mispriced_page:N` callback data
   - Summary header: total count, sport breakdown, over/under split

2. **New `handleHighConv(chatId, page)` function** (~60 lines)
   - Queries `mispriced_lines` (ELITE/HIGH) cross-referenced with `nba_risk_engine_picks` (same approach as `useHighConvictionPlays` hook)
   - Shows 5 per page with detailed rows: player, prop, edge, engines, conviction score
   - Each play shows engine dots and side agreement status
   - Pagination buttons: `highconv_page:N` callback data

3. **Callback handler updates** in `handleCallbackQuery`
   - Add `mispriced_page:N` handler to call `handleMispriced(chatId, page)`
   - Add `highconv_page:N` handler to call `handleHighConv(chatId, page)`

4. **Update command routing**
   - `/mispriced` calls `handleMispriced(chatId, 1)` instead of `handleTriggerFunction`
   - `/highconv` calls `handleHighConv(chatId, 1)` instead of `handleTriggerFunction`
   - Add `/runmispriced` as a new command that triggers the actual edge function (the old behavior)

### Display Format (Mispriced Example)

```text
MISPRICED LINES -- Feb 20
Showing 1-10 of 157 lines
NBA: 120 | MLB: 37 | OVER: 45 | UNDER: 112

ELITE EDGES:

1. Isaiah Collier -- 3PT U 0.5
   L10: 0.4 | Edge: -20%
2. Ryan Kalkbrenner -- PA U 9.5
   L10: 7.0 | Edge: -26%
...

[< Prev 10] [Next 10 >]
```

### Display Format (High Conviction Example)

```text
HIGH CONVICTION PLAYS -- Feb 20
Showing 1-5 of 17 overlaps
All Agree: 17 | Engines: risk, propv2

1. Ryan Kalkbrenner -- PA U 9.5
   Edge: -26% (HIGH)
   risk agree UNDER | Score: 11.7/30

2. Jaylen Wells -- PA U 18.5
   Edge: -26% (HIGH)
   risk agree UNDER | Score: 11.7/30
...

[< Prev 5] [Next 5 >]
```

### Files

| Action | File |
|--------|------|
| Modify | `supabase/functions/telegram-webhook/index.ts` (add 2 handlers + callback routing + update commands) |

