

## Problem: Wemby Data Bug + Daily Winners Showcase

### 1. Bug Found: NULL Line Settlement

Victor Wembanyama's points pick was marked "hit" with actual_value=17 but `actual_line` is NULL. Many picks across the system have NULL `actual_line` values, meaning the verification function (`verify-sweet-spot-outcomes` or `bot-check-live-props`) settled them without a valid line comparison. 

**Fix:** Add a NULL-line guard in both `verify-sweet-spot-outcomes` and `bot-check-live-props` so picks with no `actual_line` are skipped (left as `pending`) rather than incorrectly settled.

### 2. New Feature: "Today's Winners" Showcase on Landing Page

A new component on the `/bot` landing page that displays yesterday's verified winning picks in an animated data box, showing real proof of the system's accuracy.

**What it shows:**
- Player name, prop type, line, side, and actual value for each hit
- Hit rate summary (e.g., "47/72 picks hit -- 65%")
- Prop type breakdown with icons
- Animated entrance with staggered card reveals

**Data flow:**
- New edge function `bot-daily-winners` queries `category_sweet_spots` for yesterday's settled hits with valid `actual_line` values
- Landing page calls this function and renders the results in a scrollable animated section

### 3. Telegram Daily Winners Report

Add a new notification type `daily_winners` to `bot-send-telegram` that sends the same data as a formatted Telegram message after settlement completes.

**Format:**
```text
DAILY WINNERS REPORT -- Feb 19
================================

47/72 Picks Hit (65%)

Top Hits:
  [hit] Carlton Carrington O1.5 3PT (actual: 3)
  [hit] Tidjane Salaun O3.5 REB (actual: 4)
  [hit] Danny Wolf O5.5 REB (actual: 6)
  ...

Prop Breakdown:
  3PT: 12/18 (67%)
  REB: 15/22 (68%)
  PTS: 10/20 (50%)
  AST: 10/12 (83%)
```

### Technical Details

**Files to modify:**

1. **`supabase/functions/verify-sweet-spot-outcomes/index.ts`**
   - Add guard: skip picks where `actual_line` is NULL (don't settle them, leave as pending)
   
2. **`supabase/functions/bot-check-live-props/index.ts`**
   - Same NULL-line guard before settlement

3. **New file: `supabase/functions/bot-daily-winners/index.ts`**
   - Query `category_sweet_spots` for yesterday's `outcome = 'hit'` with non-null `actual_line`
   - Return structured JSON: winners array, hit rate, prop breakdown
   
4. **New file: `src/components/bot-landing/DailyWinnersShowcase.tsx`**
   - Animated card grid with staggered fade-in
   - Each winner shows: player name, prop icon, "O/U [line]", actual value, checkmark
   - Summary bar at top with hit rate percentage and prop breakdown
   - Scrollable/collapsible for mobile

5. **`src/pages/BotLanding.tsx`**
   - Add `DailyWinnersShowcase` component between PerformanceCalendar and WhyMultipleParlays sections

6. **`supabase/functions/bot-send-telegram/index.ts`**
   - Add `daily_winners` notification type
   - Format with icons: checkmark for hits, prop type icons, alert icons for streaks
   
7. **`supabase/functions/bot-settle-and-learn/index.ts`**
   - After settlement completes, trigger `bot-send-telegram` with type `daily_winners` containing the day's hit data

**No schema changes needed** -- all data comes from existing `category_sweet_spots` table.

