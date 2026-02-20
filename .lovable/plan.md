

## Fresh High-Conviction Parlay Blast

### The Problem

The bot is on a **7-day losing streak** (Feb 14-20). Today has 44 pending parlays but none use the new `mispriced_edge` strategy because player reuse caps blocked generation. The risk engine only returned 4 picks today (full_slate mode), limiting cross-engine overlap. We need to force-generate fresh, high-conviction parlays focused purely on the strongest statistical edges.

### What We'll Build

A **"Force Generate"** mode that:
1. Clears today's pending parlays (they haven't settled yet)
2. Generates fresh parlays using ONLY the highest-conviction picks (mispriced ELITE/HIGH + risk engine confirmed)
3. Caps at 3-leg parlays exclusively (your best-performing format at 37.1% win rate)
4. Sends the new slate to Telegram immediately

### Implementation

**1. New edge function: `supabase/functions/bot-force-fresh-parlays/index.ts`**

A focused generator that bypasses the main engine's complexity:

- Queries `mispriced_lines` for today's ELITE + HIGH confidence picks (edge >= 50%)
- Queries `nba_risk_engine_picks` for today's picks
- Cross-references for overlaps (same player + same direction = highest conviction)
- Builds 3-leg parlays using a simple greedy algorithm:
  - Rule 1: Max 1 player per team
  - Rule 2: No duplicate prop types in a parlay
  - Rule 3: Prioritize UNDER plays (historically higher hit rate per your winning formula)
  - Rule 4: Only picks with book_line > 0 (real lines)
- Generates 5-8 parlays max (quality over quantity)
- Inserts into `bot_daily_parlays` with strategy_name `force_mispriced_conviction`
- Sends to Telegram via `bot-send-telegram` with a special "FRESH CONVICTION SLATE" format

**2. Modify `supabase/functions/bot-send-telegram/index.ts`**

Add a `fresh_slate_report` notification type that formats:

```
FRESH CONVICTION SLATE -- Feb 20
==================================
5 high-conviction 3-leg parlays

PARLAY 1 (Score: 92/100)
  Kobe Brown REB U 7.5 (Edge: -64%, HIGH)
  Ben Sheppard BLK U 0.5 (Edge: -100%, HIGH)  
  Isaiah Collier BLK U 0.5 (Edge: -80%, HIGH)

PARLAY 2 (Score: 88/100)
  ...
```

**3. Optional cleanup: Clear underperforming pending parlays**

Before generating, the function can optionally mark today's existing pending `max_boost_*` parlays as `void` to declutter the calendar, keeping only the new conviction-based ones active.

### Why This Should Win

- **3-leg only**: Your data shows 37.1% win rate on 3-leggers vs 11.8% on 2-leggers
- **Mispriced edge focus**: Statistical edges of 60-180% on today's lines
- **UNDER bias**: Aligns with the winning formula's defensive filtering
- **No bloat**: 5-8 parlays instead of 44 spreads the risk thin

### Files

| Action | File |
|--------|------|
| Create | `supabase/functions/bot-force-fresh-parlays/index.ts` |
| Modify | `supabase/functions/bot-send-telegram/index.ts` (add fresh_slate_report type) |

### Post-Deploy

1. Deploy both functions
2. Invoke `bot-force-fresh-parlays` immediately
3. Verify Telegram receives the fresh slate
4. Monitor outcomes tonight

