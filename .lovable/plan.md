

## Test Mega Jackpot: Clear and Re-run

### Step 1: Clear existing lottery entries
Delete today's `mega_lottery_scanner` entries from `bot_daily_parlays` so the dedup check (which skips when >= 3 tickets exist) allows a fresh run:

```sql
DELETE FROM bot_daily_parlays 
WHERE parlay_date = CURRENT_DATE 
AND strategy_name = 'mega_lottery_scanner';
```

### Step 2: Invoke the edge function
Call `nba-mega-parlay-scanner` to generate all 3 tickets fresh, including the Mega Jackpot (Ticket 3).

### Step 3: Review logs
Check the edge function logs to verify:
- Exotic markets (first basket, double double, triple double) are being scraped
- Mega Jackpot candidates have defense rank 18+ 
- L10/L20 data is being used for validation
- Combined odds reach 10,000+ target
- Per-leg odds are +300 minimum

### What we're validating
- The Mega Jackpot ticket uses exotic props (first basket, ML underdogs, Q1 ML, double/triple double)
- Defense ranking filter of 18+ is applied for player props
- L10 and L20 averages are checked (within 0.8x of line for OVER bets)
- Combined odds target of +10,000 is reached with 4-8 legs
- All 3 tiers (Standard, High Roller, Mega Jackpot) generate successfully

### Approval needed
This requires clearing today's existing lottery data to allow a re-run. Once approved, I'll execute the delete and invoke the function.

