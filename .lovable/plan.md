

## Plan: Track All Parlays, NHL, and Bidirectional Unders + Reconfigure Stakes

### Problems Identified

1. **NHL parlays have no `simulated_stake`** — They're inserted into `bot_daily_parlays` without a stake, defaulting to $50. They need proper tier-aligned stakes.
2. **Bidirectional Unders are not tracked** — The matchup scanner identifies bench player "Under" targets and broadcasts them to Telegram, but they are **never saved as parlays** in `bot_daily_parlays`. No settlement, no P&L tracking.
3. **Stake sizes are too small to show meaningful wins** — Current config: Execution $100, Validation $50, Exploration $20, Bankroll Doubler $10. NHL uses hardcoded $50 for everything.
4. **NHL parlays have zero settled results** — All NHL entries are pending/void, meaning the settlement engine may not be properly resolving NHL props.

### Plan

#### 1. Reconfigure Stake Sizes (Database Update)
Update `bot_stake_config` to more aggressive stakes that amplify winning strategies:
- Execution: $100 → **$250** (high-confidence plays)
- Validation: $50 → **$125** (proven strategies)
- Exploration: $20 → **$50** (speculative)
- Bankroll Doubler: $10 → **$25**
- Update baselines to match

#### 2. Fix NHL Floor Lock Daily — Add Proper Stakes
Update `nhl-floor-lock-daily/index.ts` to:
- Read from `bot_stake_config` at start (like the main generator does)
- Apply tier-appropriate stakes: `execution_stake` for floor lock and optimal combo (execution tier), `exploration_stake` for ceiling shot and exploration combos
- Add `simulated_stake` and `simulated_payout` fields to all inserts

#### 3. Create Bidirectional Under Parlays from Matchup Scanner
Update `nba-matchup-daily-broadcast/index.ts` to:
- After broadcasting, convert the **bench_under** player targets into trackable parlays
- Group under targets into 3-leg parlays (player unders with 80%+ L10 hit rates)
- Insert into `bot_daily_parlays` with strategy_name `bidirectional_bench_under`, tier `execution`, and proper stakes
- This enables settlement tracking and P&L reporting

#### 4. Redeploy Both Edge Functions
- Deploy `nhl-floor-lock-daily` with stake integration
- Deploy `nba-matchup-daily-broadcast` with under parlay tracking

### Technical Details

**NHL stake integration** — Load config the same way `bot-generate-daily-parlays` does:
```typescript
const { data: stakeConfig } = await supabase
  .from('bot_stake_config').select('*').limit(1).maybeSingle();
const execStake = stakeConfig?.execution_stake ?? 250;
const explStake = stakeConfig?.exploration_stake ?? 50;
```

**Bidirectional under parlay creation** — After the broadcast, group bench_under player targets:
```typescript
// Filter for 80%+ hit rate unders
const strongUnders = benchUnders.flatMap(item => 
  item.player_targets.filter(p => p.l10_hit_rate >= 80)
);
// Build 3-leg parlays and insert into bot_daily_parlays
```

**Settlement** — The existing `bot-settle-and-learn` engine already settles all `bot_daily_parlays` entries regardless of strategy_name, so NHL and bidirectional under parlays will automatically settle once they have the proper structure.

