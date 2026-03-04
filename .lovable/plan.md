

## Plan: Save 4 Tickets to `bot_daily_parlays` & Broadcast to All Customers

### What We'll Build

An edge function (or use an existing one) to:

1. **Insert 4 parlay tickets** into `bot_daily_parlays` with today's date, `approval_status = 'approved'`:
   - **Standard (3-leg):** Ace Bailey O 4.5 REB, OG Anunoby O 1.5 3PM, Isaiah Hartenstein O 3.5 AST → +416
   - **Mid-Tier (5-leg):** Above 3 + Baylor Scheierman O 4.5 REB, Giannis O 4.5 AST → +1,953  
   - **High Roller (8-leg):** Above 5 + Isaiah Joe O 2.5 3PM, Jaylen Wells O 12.5 PTS, Bobby Portis O 1.5 3PM → +18,153
   - **Mega Jackpot (13-leg):** All 13 legs → calculated combined odds

2. **Send via `bot-send-telegram`** using `mega_lottery_v2` type (which auto-broadcasts to all active customers per line 1594)

3. **Format each ticket** with the existing lottery format: tier label, combined odds, $10 stake, potential payout, and per-leg details (player, side, line, prop, odds)

### Implementation

**New edge function: `manual-parlay-broadcast`**
- Accepts the 4 pre-built tickets with all leg data
- Inserts into `bot_daily_parlays` (strategy_name: `manual_curated`, tier per ticket)
- Calculates Mega Jackpot combined odds from all 13 legs
- Calls `bot-send-telegram` with `mega_lottery_v2` type to broadcast to admin + all customers
- Sets `approval_status = 'approved'` and `outcome = 'pending'`

### 13-Leg Mega Jackpot Calculation
All 13 legs combined using decimal odds multiplication, then converted back to American odds. Expected to be a massive longshot (~+150,000+ range).

### Files to Create/Modify
| File | Action |
|------|--------|
| `supabase/functions/manual-parlay-broadcast/index.ts` | Create — new edge function |
| `supabase/config.toml` | Auto-updated with JWT config |

