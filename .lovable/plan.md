

## Fix High Roller + Mega Jackpot: Market Diversification and Filter Tuning

### Problems Found
1. **Mega Jackpot hit +2.1 billion odds** -- it stacked only extreme exotic props (triple doubles at +2000-5000 each) with no diversification, producing unrealistic combined odds
2. **High Roller failed to generate** -- the combo of +200 min odds, 40% hit rate, and defense rank 15+ was too restrictive for the available slate

### Changes (all in `supabase/functions/nba-mega-parlay-scanner/index.ts`)

#### 1. Mega Jackpot: Market Type Diversification + Odds Cap

Add per-market-type caps to force a diverse mix:
- Max 2 `exotic_player` legs (first basket, double/triple double)
- Max 2 `team_bet` legs (ML underdog, Q1 ML)
- Max 4 `player_prop` legs (standard high-odds props)
- Cap combined odds at 50,000 (stop adding legs once reached) -- still a true lottery but not billions
- Build in rounds: pick 1 exotic, 1 team bet, 1 player prop, then fill remaining slots
- Early exit once combined odds reach 10,000+ with at least 4 legs

This ensures the ticket has a realistic structure like:
```
1x First Basket (+800), 1x Q1 ML Underdog (+250), 
1x Triple Double (+1500), 2x Player Props (+300 each)
= ~+10,000 to +50,000 combined
```

#### 2. High Roller: Relax Filters

- Hit rate: 40% down to 35%
- Defense rank: 15+ down to 12+
- L10/L20 line clearance: 1.1x down to 1.0x (just needs to meet the line)
- Allow exotic and team bet market types (currently only checks player props for L10/L20)
- If still < 3 legs after primary pass, do a relaxed pass at 30% hit rate and +150 min odds

#### 3. Sort Mega Candidates by Odds Band (not raw odds)

Instead of sorting purely by odds descending (which picks the most extreme props first), sort by "closeness to +400-800 sweet spot" to favor moderate high-odds legs over extreme ones:
- Preferred range: +300 to +800 per leg (manageable odds that sum to 10k+ with 4-6 legs)
- Deprioritize +1500 legs unless needed to reach the target

### After Fix: Clear and Re-run
Once the code is updated, clear today's lottery entries and invoke the scanner again to validate all 3 tickets generate with proper diversification.

