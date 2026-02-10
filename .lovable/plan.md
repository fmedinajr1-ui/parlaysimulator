
# Fix: AI Hallucinating Player Names in `/parlay` Telegram Command

## Root Cause

The `/parlay` command is not a registered Telegram command. It falls through to the AI natural language handler, which sends high-level stats (win rate, ROI, category weights) to Gemini Flash but **zero actual parlay leg data**. The AI model fabricates player names like "Trae Young" based on category names like "THREE_POINT_SHOOTER" -- even though Trae Young has been OUT since January 24th and has no active props.

This is not a data pipeline issue. The scraper, analyzer, and generator are all correctly excluding Trae Young. The problem is purely in the Telegram AI response.

## Fix: Two Changes

### 1. Register `/parlay` as a proper command (not AI fallback)

Add a dedicated `/parlay` handler that fetches **real pending parlay data** from `bot_daily_parlays` and displays the actual top-weighted legs. This eliminates AI hallucination entirely.

The handler will:
- Query `bot_daily_parlays` for today's pending parlays
- Extract and deduplicate all legs across parlays
- Sort by category weight or confidence score
- Display the top 3-5 real legs with actual player names, lines, and props
- Include the same bankroll/mode/ROI summary

### 2. Add real leg data to the AI system prompt

For the natural language fallback, inject the top 5 actual pending legs into the system prompt so the AI can reference real data instead of guessing. This prevents hallucination for any free-form question about current parlays.

## Technical Details

### File Modified
- `supabase/functions/telegram-webhook/index.ts`

### New `/parlay` Handler
```text
Register: if (cmd === "/parlay") return await handleParlayStatus(chatId);

handleParlayStatus():
  1. Query bot_daily_parlays WHERE outcome = 'pending' AND parlay_date = today
  2. Extract all legs, deduplicate by player_name + prop_type
  3. Sort by category weight (from bot_category_weights)
  4. Format top 5 legs with real data:
     "1. Steph Curry O 4.5 3PM (Verified)"
     "2. Alex Caruso U 8.5 PTS (Verified)"
  5. Include parlay count, bankroll, mode, ROI
```

### AI Prompt Enhancement
Add to the system prompt context:
```text
- Top Pending Legs: {actual legs from bot_daily_parlays}
```

This way both the dedicated command and the AI fallback will show real, verified player data instead of fabricated names.
