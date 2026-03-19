

# Fix Hedge Recommendations to Use Actual Sportsbook Lines

## Problem
Hedge recommendations say "Bet UNDER 24.5" using the original sweet spot analysis line, not the actual FanDuel/live sportsbook line. Three places are affected:

1. **Telegram Tracker** — uses `pick.recommended_line` as `liveBookLine` (line 327), never fetches actual market lines
2. **PropHedgeIndicator** — displays "Consider UNDER {line}" / "Bet OVER {line}" using the original line, not the live book line
3. **HedgeRecommendation.tsx** — already has live line data but some action text still references the original line

## Solution
Query `unified_props` for the actual FanDuel/market line and use it in all hedge recommendation text and logic.

## Changes

### 1. Telegram Tracker — Fetch Real Lines from `unified_props`
**File**: `supabase/functions/hedge-live-telegram-tracker/index.ts`

- After fetching picks (~line 160), query `unified_props` for matching active props:
  ```sql
  SELECT player_name, prop_type, current_line, bookmaker, over_price, under_price
  FROM unified_props WHERE is_active = true AND player_name IN (...)
  ```
- Build a lookup map `actualLineByKey[player::prop_type] = { line, bookmaker, prices }`
- Replace line 327: use `actualLineByKey[key]?.line` as `liveBookLine` instead of `pick.recommended_line`
- Update hedge message text (lines 416-420) to show the actual book line:
  - "HEDGE ALERT — Consider UNDER 25.5 (FanDuel)" instead of just the sweet spot line
  - Include the price when available: "UNDER 25.5 (-110)"

### 2. PropHedgeIndicator — Accept and Display Live Line
**File**: `src/components/scout/PropHedgeIndicator.tsx`

- Update the `PropEdge` usage to check for a `liveBookLine` field (already exists on some edge objects)
- Change line 56-57: when `liveBookLine` is available, show it instead of original line:
  - `"Consider UNDER ${liveBookLine}"` instead of `"Consider UNDER ${line}"`
  - `"Bet OVER ${liveBookLine}"` instead of `"Bet OVER ${line}"`
- Fall back to original line when live line isn't available

### 3. HedgeRecommendation — Ensure Action Text Uses Live Line
**File**: `src/components/sweetspots/HedgeRecommendation.tsx`

- Review action strings in the status determination block (lines 380+) to ensure all "hedge" / "bet opposite" recommendations reference `hedgeLine` (the live book line) rather than `line` (original)
- Already partially done — verify completeness and fix any remaining references to original `line` in action strings

### 4. Telegram Message Format Enhancement
When a real book line is available, messages will show:
```
🟠 HEDGE ALERT — LeBron James PTS O24.5

📊 Status: 🟢 HOLD → 🟠 HEDGE ALERT
📈 Current: 12 pts | Projected: 22.8
⏱️ Q3 8:42 | Progress: 58%

💡 Consider: UNDER 26.5 (-110) on FanDuel
   (Your line: O24.5 | Book line: 26.5)
```

Instead of the current generic "Consider UNDER 24.5".

