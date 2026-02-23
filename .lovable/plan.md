

## Fix Mega Parlay Scanner Telegram Report + Send to Customers

### Problem

The mega parlay scanner report is showing raw JSON in Telegram because:
1. The scanner sends `type: 'mega_parlay_scanner'` to `bot-send-telegram`, but that type isn't in the `NotificationType` union or the `formatMessage` switch — so it falls through to `default: return "Bot Update: ${JSON.stringify(data)}"` (line 81)
2. The report only goes to the admin chat ID, not to customer accounts in `bot_authorized_users`

### Fix 1: Add proper formatter in `bot-send-telegram`

**File:** `supabase/functions/bot-send-telegram/index.ts`

- Add `'mega_parlay_scanner'` to the `NotificationType` union (line 36)
- Add a case in the `formatMessage` switch (line 47)
- Add a new `formatMegaParlayScanner()` function that produces a clean report:

```
🏀 NBA MEGA PARLAY SCANNER
━━━━━━━━━━━━━━━━━━━━
Feb 23 | +100 Odds Only

📊 Scanned: 250 props across 12 games
✅ 174 qualified

🎯 RECOMMENDED PARLAY (3 legs)
💰 Combined: +1112
💵 $25 bet -> $303.00

Leg 1: Russell Westbrook
  OVER 1.5 threes (+102) [fanduel]
  Hit: 0.9% | Edge: N/A | Score: 20.4
  L10 Med: 2 | Avg: 2

Leg 2: Malik Monk
  OVER 2.5 threes (+150) [hardrockbet]
  Hit: 0.9% | Edge: N/A | Score: 20.0
  L10 Med: 3 | Avg: 2.9

Leg 3: James Harden
  OVER 2.5 threes (+140) [fanduel]
  Hit: 1.0% | Edge: N/A | Score: 19.7
  L10 Med: 3 | Avg: 2.7
```

The formatter will parse the `data.message` string (already pre-formatted by the scanner) and clean it up properly, or better yet, accept structured data and format it cleanly.

### Fix 2: Update the scanner to send structured data

**File:** `supabase/functions/nba-mega-parlay-scanner/index.ts`

Change the Telegram call (lines 468-472) to send structured data instead of a pre-built message string:

```typescript
body: JSON.stringify({
  type: 'mega_parlay_scanner',
  data: {
    date: today,
    scanned: rawProps.length,
    events: events.length,
    qualified: scoredProps.length,
    legs: parlayBreakdown,
    combinedOdds: combinedAmericanOdds,
    payout25: parlayPayoutOn25.toFixed(2),
  }
})
```

### Fix 3: Broadcast to customers

**File:** `supabase/functions/bot-send-telegram/index.ts`

After sending to the admin, also send to all authorized customers from `bot_authorized_users`:

- Query `bot_authorized_users` for all rows with `is_authorized = true`
- Send the same formatted message to each customer's `chat_id`
- Skip quiet hours check for mega scanner reports (they're manually triggered)

### Fix 4: Add to the bypass list

Add `'mega_parlay_scanner'` to the quiet hours / notification preference bypass list on line 819 so it always sends (since it's manually triggered).

### Technical Summary

| File | Change |
|------|--------|
| `supabase/functions/bot-send-telegram/index.ts` | Add `mega_parlay_scanner` type, formatter function, customer broadcast logic |
| `supabase/functions/nba-mega-parlay-scanner/index.ts` | Send structured data instead of raw message string |

Both edge functions will be redeployed automatically after changes.
