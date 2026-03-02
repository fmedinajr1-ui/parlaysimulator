

# Show Customers Sweet Spot Accuracy + Strategy Announcement

## What We're Doing
Two things:
1. Add a new `/accuracy` command for customers that shows the Sweet Spot engine's accuracy stats
2. Update the announcement function with a new message announcing Sweet Spots as the main engine

## Changes

### 1. Add `/accuracy` customer command
**File:** `supabase/functions/telegram-webhook/index.ts`

Add a new `handleCustomerAccuracy` function that:
- Queries `category_sweet_spots` for settled picks (outcome = won/hit/lost/miss)
- Groups by time period (last 7d, 30d, all-time)
- Shows win rate, total settled, and a confidence grade
- Formats it cleanly for customers (no internal engine jargon)

Wire it up in the customer commands section and add it to the `/help` response.

### 2. Format the accuracy message for Telegram
**File:** `supabase/functions/bot-send-telegram/index.ts`

Not needed -- we'll format inline in the webhook handler like other customer commands (returns a string directly).

### 3. Update the announcement message
**File:** `supabase/functions/bot-announce-strategy-update/index.ts`

Replace the current `/lookup` announcement with a new message:
- Announce Sweet Spots as the primary engine powering all parlays
- Share the real-time accuracy stats (pulled live from the database at broadcast time)
- Explain what this means for customers: every parlay now has 3 core legs from the highest-accuracy engine
- Mention the `/accuracy` command so they can check it anytime

### 4. Deploy all 3 edge functions

## Technical Details

**Customer accuracy message format:**
```
📊 Sweet Spot Engine — Accuracy Report

🟢 Last 7 Days: 82.3% (51W - 11L)
🟢 Last 30 Days: 79.1% (138W - 33L)  
🟢 All-Time: 76.4% (412W - 128L)

This is the engine powering your parlays.
Type /accuracy anytime to check live stats.
```

**Announcement message format:**
```
🚀 STRATEGY UPDATE — Sweet Spot Engine

We've upgraded our parlay system. Every execution 
parlay now uses our Sweet Spot Engine as the 
foundation — all 3 core legs come from picks with 
70%+ historical hit rates.

Current accuracy: [live stat]% ([W]W - [L]L)

What changed:
• All 3 legs in your parlays come from the Sweet Spot engine
• Optional 4th leg only added if it passes strict quality gates  
• Mispriced-only parlays are now a backup, not the default

Type /accuracy to see live engine stats anytime.
```

**Files modified:** 3 edge functions
- `telegram-webhook/index.ts` -- add `/accuracy` command + help text
- `bot-announce-strategy-update/index.ts` -- new announcement with live stats
- Deploy all updated functions

