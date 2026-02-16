

# Redesign Telegram Parlay Messages for Clarity and Actionability

## Problem
The current Telegram messages for parlays are hard to read and don't clearly communicate:
- **What action to take** (Take Over/Under, Take Team +spread, Take Moneyline)
- **Why the bot picked it** (no reasoning summary)
- The formatting is dense and cluttered

## Changes

### 1. Rewrite `formatLegDisplay()` in `telegram-webhook/index.ts`
The current function outputs something like:
`SE Louisiana Lions @ East Texas A&M Lions Spread away 1.5 (-110)`

**New format** -- clear action-first display with reasoning:

```
Take East Texas A&M -1.5 (-110)
  SE Louisiana @ East Texas A&M | NCAAB
  Score: 69 | Hit Rate: 65% | Source: Whale Signal
```

For player props:
```
Take LeBron James OVER 25.5 PTS (-115)
  LAL @ BOS | NBA
  Score: 82 | Hit Rate: 78% | Buffer: +4.0
```

For totals:
```
Take UNDER 135.5 (-110)
  Louisiana @ Old Dominion | NCAAB
  Score: 69 | Hit Rate: 65% | Source: Whale Signal
```

Logic:
- **Spreads**: Show "Take [team] [line]" using `side` to pick home/away team name
- **Totals**: Show "Take OVER/UNDER [line]"
- **Moneylines (h2h)**: Show "Take [team] ML"
- **Player props**: Show "Take [name] OVER/UNDER [line] [prop]"
- Second line: matchup + sport label
- Third line: composite score, hit rate, and source/reason (from `line_source` or `line_selection_reason`)

### 2. Upgrade `/parlays` handler (`handleParlays`)
Currently shows a compact tier summary with only strategy name + odds. Change to **show all legs inline** for each parlay (up to top 2 per tier) so users don't need to click "View Legs":

```
PARLAY GENERATION COMPLETE

Exploration (8) -- $0 stake
  1. premium_boost (3-leg) +450
     Take East Texas A&M -1.5 (-110)
     Take UNDER 135.5 (-110)
     Take Murray St -3.5 (-110)
     Avg Score: 74 | Avg Hit: 72%

  2. cross_sport (4-leg) +680
     ...
```

Keep the "View Legs" inline buttons as a fallback for the "+X more" parlays.

### 3. Upgrade generation notification in `bot-send-telegram/index.ts`
The `formatParlaysGenerated` and `formatTieredParlaysGenerated` messages currently only show count/distribution stats. Add a "Top Picks Preview" section showing the top 3-5 individual legs by composite score, so the user gets immediate actionable info when the generation alert fires.

This requires passing the top picks data from the generator to the telegram notification payload.

### 4. Update the `legs:` callback query handler
The existing "View Legs" button handler already calls `formatLegDisplay` -- it will automatically pick up the new format. Just ensure the message structure adds a small "Why" summary line at the bottom using the parlay's `strategy_name` and average scores.

### 5. Source/Reason Labels
Map `line_source` and `line_selection_reason` to human-readable short labels:
- `whale_signal` -> "Whale Signal"
- `projection_gap` -> "Projection Edge"
- `alternate_line` -> "Alt Line Shop"
- `main_line` -> "Main Line"
- `single_pick` -> "Single Pick"

## Files Modified
1. `supabase/functions/telegram-webhook/index.ts` -- `formatLegDisplay()`, `handleParlays()`, `handleCallbackQuery(legs:)`
2. `supabase/functions/bot-send-telegram/index.ts` -- `formatParlaysGenerated()`, `formatTieredParlaysGenerated()`
3. `supabase/functions/bot-generate-daily-parlays/index.ts` -- Pass top picks in the Telegram notification payload

## Technical Notes
- Leg data already contains all needed fields: `composite_score`, `hit_rate`, `line_source`, `line_selection_reason`, `projection_buffer`, `side`, `prop_type`, `line`, `player_name`, `sport`, `category`
- Sport labels will map `basketball_ncaab` -> `NCAAB`, `baseball_ncaa` -> `NCAA BB`, etc.
- Telegram Markdown requires careful escaping -- will keep using the existing plain-text fallback pattern
- Redeploy `telegram-webhook`, `bot-send-telegram`, and `bot-generate-daily-parlays`
