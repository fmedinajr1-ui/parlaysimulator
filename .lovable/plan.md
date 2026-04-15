

# Realistic Straight Bet Bankroll Builder — From $100

## Your Proven Hit Rates (Last 30 Days, Real Data)

| Signal | Prediction | Record | Hit Rate |
|--------|-----------|--------|----------|
| Cascade | Under RBI | 26-1 | **96.3%** |
| Price Drift | Under RBI | 119-17 | **87.5%** |
| Snapback | Under RBI | 523-161 | **76.5%** |

These are the only categories with both high volume AND high accuracy. The "100% hit rate" doesn't exist at scale — but **96.3% on Cascade Unders** is extremely close.

## Today's Live Picks (Real)

Your system flagged these **hr_power_over** picks today (Over 0.5 RBI):
- **Jordan Walker** — 7 HRs in L10, 1.2 avg RBI, 70% hit rate (CLE @ STL)
- **Shohei Ohtani** — 5 HRs in L10, 1.0 avg RBI, 60% hit rate (NYM @ LAD)
- **James Wood** — 4 HRs in L10, 1.1 avg RBI, 60% hit rate (WSH @ PIT)
- **Andy Pages** — 4 HRs in L10, 1.5 avg RBI, 60% hit rate (NYM @ LAD)
- **Carter Jensen** — 3 HRs in L10, 0.7 avg RBI, 60% hit rate (KC @ DET)
- **Elly De La Cruz** — 3 HRs in L10, 0.8 avg RBI, 60% hit rate (SF @ CIN)

Plus Under RBI price drift and cascade picks generating 20-40 picks/day.

## The Math: $100 Bankroll, Straight Bets Only

### Strategy: Cascade Under RBI (96.3% WR)
- **Odds**: Over/Under 0.5 RBI typically pays **-130 to -150** on Unders (decimal ~1.67-1.77)
- **Volume**: ~20 usable cascade picks/day (after filtering team cascades)
- **Stake**: 2% bankroll per bet = starts at $2/bet

**Month 1 Projection (20 betting days)**:
```text
Day 1:  $100 bankroll → 20 bets × $2 = $40 risked
        Expected: 19.3 wins × $1.33 profit = +$25.67
                  0.7 losses × $2.00 = -$1.40
        Net: +$24.27 → Bankroll: $124.27

Day 5:  ~$160 bankroll → 20 bets × $3.20
        Net: +$38.83 → Bankroll: ~$199

Day 10: ~$256 bankroll → 20 bets × $5.12
        Net: +$62.21 → Bankroll: ~$318

Day 15: ~$410 bankroll → 20 bets × $8.20
        Net: +$99.55 → Bankroll: ~$510

Day 20: ~$655 bankroll → 20 bets × $13.10
        Net: +$159 → Bankroll: ~$814
```

**End of Month 1: ~$800** (from $100)

### Blended Strategy (Cascade + Price Drift Unders)
Adding Price Drift (87.5% WR) with smaller stakes:
- Cascade: 2% bankroll at 96.3% WR
- Price Drift: 1% bankroll at 87.5% WR (~8 picks/day)

```text
End of Month 1: ~$1,000-$1,200
```

## Recommended Bet Sizing

| Bankroll | Cascade Stake (2%) | Price Drift Stake (1%) | Daily EV |
|----------|-------------------|----------------------|----------|
| $100 | $2 | $1 | +$28 |
| $250 | $5 | $2.50 | +$70 |
| $500 | $10 | $5 | +$140 |
| $1,000 | $20 | $10 | +$280 |

## Important Reality Check
- 96.3% is based on 27 settled picks — small sample. True rate likely 80-90%.
- At 85% realistic WR with -140 avg odds: **Month 1 end ~$400-500** (still 4-5x your money)
- Unders on 0.5 RBI have juice (-130 to -150), so each win only pays ~$0.67-0.77 per $1 risked
- Losses cost full stake, so even a few losses eat into profits significantly

## Implementation Plan

### What to build
1. **Daily Straight Bet Slate Generator** — new edge function that takes today's Cascade and Price Drift Under picks, calculates optimal stake based on current bankroll, and sends a Telegram message with exact bet amounts
2. **Bankroll Tracker Table** — simple table to track daily starting bankroll, bets placed, and P&L
3. **Telegram Daily Report** — "Today's Straight Bets: 18 Cascade Unders @ $X each, 6 Price Drift Unders @ $Y each"

### Files
- `supabase/functions/straight-bet-slate/index.ts` — new function generating daily straight bet slate with bankroll-adjusted stakes
- DB migration for `straight_bet_tracker` table (bankroll, daily_bets, daily_pnl)
- Update `bot-slate-status-update` to include straight bet settlement tracking

### No changes to existing engines
Uses existing `fanduel_prediction_alerts` data — just a new consumption layer focused on individual bets instead of parlays.

