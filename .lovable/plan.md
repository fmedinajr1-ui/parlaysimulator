

## Add Individual Leg Breakdown to Settlement Report

### What This Does
When parlays are settled, the system already determines which individual legs hit vs missed. This change will include that per-leg detail in the Telegram settlement report so you can see exactly what hit and what busted.

### Changes

**1. Collect per-parlay leg results during settlement (bot-settle-and-learn)**

After settling each parlay, build a summary array of settled parlays with their leg-level outcomes. This data gets passed to the Telegram notification alongside the existing aggregate stats.

Data structure sent to Telegram:
- Each settled parlay includes: strategy name, tier, outcome (won/lost), odds, and a list of legs with player name, prop type, line, side, outcome (hit/miss), and actual value.

**2. Update the Telegram settlement message (bot-send-telegram)**

Enhance the `formatSettlement` function to include a leg-by-leg breakdown section at the bottom of the report. Format:

```
DAILY SETTLEMENT REPORT
========================
Date: Feb 19
Result: 2/10 parlays hit (20%)
P/L: -$450 (simulation)
Bankroll: $1200 -> $750

--- LEG BREAKDOWN ---

Parlay #1 (Execution) - LOST
  [miss] Trae Young O25.5 PTS (actual: 22)
  [hit]  Onyeka Okongwu O8.5 REB (actual: 11)
  [miss] Risacher O3.5 REB (actual: 2)

Parlay #2 (Validation) - WON
  [hit]  LeBron James O7.5 AST (actual: 9)
  [hit]  Anthony Davis O10.5 REB (actual: 14)
  [hit]  Austin Reaves O2.5 3PT (actual: 4)

--- TOP BUSTERS ---
Risacher O3.5 REB: 0/3 parlays (actual: 2)
Trae Young O25.5 PTS: 0/2 parlays (actual: 22)
```

**3. Add "Top Busters" summary**

Aggregate which individual legs appeared in the most losing parlays. This highlights the picks that caused the most damage across the slate — directly answering "what went wrong."

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/bot-settle-and-learn/index.ts` | Build per-parlay leg result summaries and pass to Telegram notification data |
| `supabase/functions/bot-send-telegram/index.ts` | Enhance `formatSettlement` to render leg-by-leg breakdown and "Top Busters" section |

### Technical Details

- In `bot-settle-and-learn`, after the parlay settlement loop (around line 766), collect an array of `settledParlayDetails` containing each parlay's legs with their outcomes. Cap at 15 parlays to avoid hitting Telegram's 4096-char message limit.
- In `bot-send-telegram`, the `formatSettlement` function receives the new `parlayDetails` array in `data` and appends the breakdown. Uses `sendLongMessage` if the message exceeds 4096 chars.
- "Top Busters" aggregates legs with `outcome === 'miss'` across all settled parlays, sorted by frequency, showing the top 5.
- Legs show actual values when available (e.g., "actual: 22") so you can see how close or far off each pick was.

