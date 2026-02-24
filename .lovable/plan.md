

## Insert Longshot Parlay + Broadcast Announcement with Recent Win Highlight

### What This Does
1. Add a new `longshot_announcement` message type to `bot-send-telegram` that formats a hype announcement referencing the Feb 9 win
2. Create a new `bot-insert-longshot-parlay` edge function that inserts tonight's 6-leg parlay into `bot_daily_parlays` and triggers the Telegram broadcast to all customers
3. The announcement will highlight the previous +4741 winner ("Going for TWO in a row!")

### Changes

#### 1. `supabase/functions/bot-send-telegram/index.ts`

- Add `'longshot_announcement'` to the `NotificationType` union (line 20)
- Add case in `formatMessage` switch (line 51)
- Add `'longshot_announcement'` to the customer broadcast list (line 1090)
- New `formatLongshotAnnouncement()` function that outputs:

```text
🚀 LONGSHOT PARLAY — Feb 24
━━━━━━━━━━━━━━━━━━━━

🏆 LAST LONGSHOT: +$4,741 on Feb 9
3 legs hit, 3 voided — full payout!
We're going for TWO IN A ROW 🔥

🎯 6-LEG EXPLORER | ~+4700

Leg 1: Carlton Carrington
  Take OVER 1.5 3PT
  💎 80.3% edge | Avg 2.6

Leg 2: Joel Embiid
  Take OVER 3.5 AST
  💎 High floor | Avg 5.8

Leg 3: Jarrett Allen
  Take OVER 8.5 REB
  💎 25% edge | Avg 11.3

Leg 4: Andrew Nembhard
  Take OVER 6.5 AST
  💎 Volume play | Avg 8.4

Leg 5: Kyshawn George
  Take OVER 2.5 AST
  💎 Low line | Avg 3.2

Leg 6: Kam Jones
  Take UNDER 8.5 PTS
  💎 Contrarian | Avg 5.2

💰 $100 → ~$4,800
⚠️ HIGH RISK / HIGH REWARD
🎲 Good luck — let's eat!
```

#### 2. New: `supabase/functions/bot-insert-longshot-parlay/index.ts`

This edge function will:
1. Insert one record into `bot_daily_parlays` with:
   - `strategy_name`: `'explore_longshot'`
   - `tier`: `'exploration'`
   - `leg_count`: 6
   - `parlay_date`: today (Eastern)
   - `expected_odds`: 4700
   - `simulated_stake`: 100
   - `outcome`: `'pending'`
   - `legs`: JSON array with the 6 legs (player name, prop type, side, line, and edge notes)
2. Call `bot-send-telegram` with type `longshot_announcement` to broadcast to admin + all active customers

#### 3. Legs Data

| # | Player | Prop | Line | Side | Edge |
|---|--------|------|------|------|------|
| 1 | Carlton Carrington | threes | 1.5 | over | 80.3% edge, avg 2.6 |
| 2 | Joel Embiid | assists | 3.5 | over | avg 5.8 |
| 3 | Jarrett Allen | rebounds | 8.5 | over | 25% edge, avg 11.3 |
| 4 | Andrew Nembhard | assists | 6.5 | over | avg 8.4 |
| 5 | Kyshawn George | assists | 2.5 | over | avg 3.2 |
| 6 | Kam Jones | points | 8.5 | under | contrarian, avg 5.2 |

### Files Modified
- `supabase/functions/bot-send-telegram/index.ts` -- add `longshot_announcement` type, formatter, and broadcast
- `supabase/functions/bot-insert-longshot-parlay/index.ts` -- new edge function (insert + trigger broadcast)

