

# Send Daily Sweet Spot Picks via Telegram

## Problem
The pipeline analyzes and stores individual sweet spot picks in `category_sweet_spots`, but never sends them to you via Telegram. Only parlays get broadcast — the best individual picks are invisible unless you check the dashboard.

## Solution
Add a new phase to the orchestrator that queries today's top sweet spot picks and sends them as a formatted Telegram message to admin.

## Changes

### 1. New Edge Function: `broadcast-sweet-spots`
- Queries `category_sweet_spots` for today's date, `is_active = true`, confidence ≥ 70, ordered by confidence descending
- Groups picks by category (e.g., Points, Rebounds, Assists)
- Formats a clean Telegram message showing: player, prop, side, line, confidence, hit rate
- Sends via `bot-send-telegram` with `admin_only: true`
- Caps at top ~20 picks to keep the message readable

### 2. Add Formatter to `bot-send-telegram/index.ts`
- Add a `sweet_spots_broadcast` message type
- Format: grouped by category, each pick showing player name, prop type, recommended side/line, confidence score, L10 hit rate

### 3. Wire Into Orchestrator: `refresh-l10-and-rebuild/index.ts`
- Add a new phase after `phase3h` (slate status) that invokes `broadcast-sweet-spots`
- Runs at the very end so all analysis is complete before broadcasting

## Message Format Example
```text
🎯 *Today's Sweet Spot Picks*
━━━━━━━━━━━━━━━━━━━━━

📊 *Points*
• LeBron James — O25.5 Pts (87% conf, 80% L10)
• Jayson Tatum — O27.5 Pts (82% conf, 70% L10)

📊 *Rebounds*
• Nikola Jokic — O11.5 Reb (85% conf, 90% L10)

📊 *Assists*
• Tyrese Haliburton — O9.5 Ast (79% conf, 75% L10)

Total: 15 picks | Avg confidence: 81%
```

## Files Changed
1. **New**: `supabase/functions/broadcast-sweet-spots/index.ts`
2. **Edit**: `supabase/functions/bot-send-telegram/index.ts` — add `sweet_spots_broadcast` type + formatter
3. **Edit**: `supabase/functions/refresh-l10-and-rebuild/index.ts` — add phase after slate status

