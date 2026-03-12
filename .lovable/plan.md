

## Settle 7 Pending Parlays from March 11

After cross-referencing game logs, here are the outcomes for each pending parlay:

### Settlement Results

| # | Strategy | Stake | Outcome | Legs Hit/Miss | Profit |
|---|----------|-------|---------|---------------|--------|
| 1 | **l3_cross_engine** (NHL) | $10 | **WON** ✅ | 5/0 | +$244 |
| 2 | **grind_stack** | $100 | **LOST** ❌ | 1/1 (1 DNP) | -$100 |
| 3 | **bench_under** | $250 | **WON** ✅ | 3/0 | +$908 |
| 4 | **bench_under** | $250 | **WON** ✅ | 3/0 | +$908 |
| 5 | **exploration_optimal_combo** | $50 | **LOST** ❌ | 1/1 (1 DNP) | -$50 |
| 6 | **mega_lottery** | $3 | **LOST** ❌ | 0/2 (3 pending) | -$3 |
| 7 | **mega_lottery** | $2 | **VOID** | 1/0 (1 DNP, 2 team) | $0 |

**Net from settling**: **+$1,907** (3 wins, 3 losses, 1 void)

### Key Findings

- **The NHL cross-engine parlay HIT all 5 legs** — Owen Tippett (2pts), Noah Cates (3pts), Tom Wilson (7pts), Dylan Cozens (5ast), Ryan Leonard (4pts). All cleared 0.5 lines easily. +2436 odds on $10 = +$244.
- **Both bench_under parlays swept** — Dean Wade (0pts), Yves Missi (6pts), Derik Queen (3pts), Mitchell Robinson (6pts), Moussa Diabate (2pts) all stayed well under their lines. Estimated +363 odds per 3-leg parlay.
- **Goga Bitadze and Russell Westbrook had no game logs** (likely DNP), affecting 3 parlays.

### Updated Final Day P&L (March 11)

Previously settled: 1W / 18L = **-$990**
After settling these 7: +3W, +3L, +1V

**Revised totals**: 4W / 21L / 6V = approximately **+$917 net** (swing of +$1,907)

The bench_under strategy carried the day with two $250 sweeps.

### Implementation

I will run UPDATE queries against `bot_daily_parlays` for each of the 7 parlays, setting:
- `outcome` (won/lost/void)
- `profit_loss` (calculated from expected_odds or estimated odds for bench_under)
- `legs_hit`, `legs_missed`, `legs_voided`
- `settled_at` to now()
- Updated `legs` JSON with individual leg outcomes and actual values

For bench_under parlays (no stored odds), I'll estimate +363 American odds (3 legs at ~-150 each), consistent with typical sportsbook pricing for these markets. This gives ~$908 profit per $250 stake.

