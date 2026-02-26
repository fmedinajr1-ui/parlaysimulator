

## Auto-Promote Winning Mispriced Edge Patterns to Execution Tier + Stacking Enhancements

### What This Does

Adds a **dynamic strategy promotion system** that automatically detects which `mispriced_edge` patterns are winning at high rates (like the 48% from Feb 25th) and injects them into the execution tier at runtime. Also lowers the execution tier coherence gate so these promoted parlays can actually pass through.

### How It Works

```text
Before Generation:
  1. Query last 14 days of settled mispriced_edge parlays
  2. Group by sport + leg count + sort method
  3. Find patterns with >= 40% win rate and >= 5 appearances
  4. Inject matching profiles into execution tier with 60%+ minHitRate
  5. Lower coherence gate from 85 to 70 for execution tier

During Generation:
  - Promoted mispriced_edge profiles run alongside existing execution strategies
  - Stacking coherence still validates leg alignment (pace, defense, team totals)
  - But the gate is relaxed enough that quality mispriced combos pass through
```

### Changes

**Modified File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **New function: `detectWinningMispricedPatterns(supabase)`**
   - Queries `bot_daily_parlays` for the last 14 days where `strategy_name = 'mispriced_edge'` and outcome is `won` or `lost`
   - Groups results by sport composition (NBA, NHL, all, cross-sport) and leg count
   - Calculates win rate per pattern group
   - Returns patterns with >= 40% win rate and >= 5 settled parlays
   - Each pattern includes: sport filter, leg count, observed win rate, sample size

2. **New function: `autoPromoteToExecution(winningPatterns)`**
   - Takes the winning mispriced patterns and creates execution-tier profile entries
   - Sets `minHitRate` to 60 (execution floor) and `sortBy` to 'hit_rate' for half, 'composite' for the other half
   - Caps at 8 promoted profiles to avoid flooding execution tier
   - Logs each promotion with the observed win rate that triggered it

3. **Call both functions during initialization (alongside `detectWinningArchetypes`)**
   - After dynamic archetype detection, run `detectWinningMispricedPatterns`
   - Append promoted profiles to `TIER_CONFIG.execution.profiles`
   - Log summary: "Promoted N mispriced_edge patterns to execution tier"

4. **Lower execution tier coherence gate from 85 to 70**
   - The current 85 threshold is too strict and blocks most execution-tier parlays from generating (Feb 25: only 10.5% hit rate on the few that passed)
   - Lowering to 70 aligns execution with validation tier and lets coherent-but-not-perfect combos through
   - The stacking logic (pace alignment, team total signals, cluster matching) still applies — this just lowers the rejection floor

5. **Increase execution tier count from 10 to 15**
   - With more profiles from promotion, allow more execution-tier parlays to generate
   - This gives the promoted mispriced patterns room to produce output

### Technical Details

**Pattern Detection Query:**
```sql
SELECT strategy_name, outcome, legs
FROM bot_daily_parlays
WHERE parlay_date >= (today - 14 days)
  AND strategy_name = 'mispriced_edge'
  AND outcome IN ('won', 'lost')
```

Then in code, extract the sport composition from each parlay's legs array and group by `{sports, legCount}` to find which specific mispriced configurations are winning.

**Promoted Profile Format:**
```typescript
{
  legs: 3,
  strategy: 'mispriced_edge_promoted',
  sports: ['basketball_nba'], // from winning pattern
  minHitRate: 60,
  sortBy: 'hit_rate',
  useAltLines: false
}
```

**Coherence Gate Change:**
- Line ~5944: `coherence < 85` becomes `coherence < 70` for execution tier
- This single change unblocks execution-tier generation while maintaining the stacking alignment bonuses/penalties

**Safety:**
- Maximum 8 promoted profiles per cycle (prevents runaway)
- 14-day lookback with minimum 5 sample requirement (prevents flukes)
- Promoted profiles still go through all existing filters (hit rate, edge, Monte Carlo simulation)
- The `mispriced_edge_promoted` strategy name distinguishes them in logs and settlement tracking

