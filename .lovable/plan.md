

## Rebrand Mega Parlay Scanner as "Daily Lottery Parlay" + Risk Disclaimer

### Changes

**File:** `supabase/functions/bot-send-telegram/index.ts` (lines 762-787)

Update `formatMegaParlayScanner()` to:

1. Rename the header from "NBA MEGA PARLAY SCANNER" to "DAILY LOTTERY PARLAY"
2. Add a risk disclaimer at the top and bottom of the report
3. Keep all existing leg data, odds, and payout info intact

**New report format:**

```
🎰 DAILY LOTTERY PARLAY
━━━━━━━━━━━━━━━━━━━━
Feb 23 | +100 Odds Only

⚠️ HIGH RISK / HIGH REWARD
This is a lottery-style parlay — slight risk involved.
Bet only what you can afford to lose.

📊 Scanned: 250 props across 12 games
✅ 174 qualified

🎯 RECOMMENDED PARLAY (3 legs)
💰 Combined: +1112
💵 $25 bet → $303.00

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

🎲 Good luck! Play responsibly.
```

### What stays the same

- Customer broadcast logic (already works)
- Structured data from scanner (no changes to `nba-mega-parlay-scanner`)
- Bypass list for quiet hours (already in place)
- All leg details, scoring, and payout calculations

### Technical Summary

| File | Change |
|------|--------|
| `supabase/functions/bot-send-telegram/index.ts` | Update `formatMegaParlayScanner()` header, add risk disclaimer |

One file, one function edit. Redeploys automatically.

