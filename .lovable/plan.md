

## Add Personalized Stake Sizing to All Parlay Broadcasts

### Problem
When parlays are broadcast (including after voided leg notifications), customers receive the bot's base stake amounts (e.g., `$10→$89`) rather than stakes calculated from their personal bankroll. The `new_strategies_broadcast` type isn't mapped in the `tierStakePercent` lookup, so customers get no personalized stake info at all for strategy parlays.

### Solution

**Edit `supabase/functions/bot-send-telegram/index.ts`** — two changes:

**1. Personalize `formatNewStrategiesBroadcast` per customer (lines 1837-1895)**
- Add `new_strategies_broadcast` to the broadcast section's personalization logic
- Instead of appending a single generic line, **rewrite the stake/payout values inline** for each customer based on their bankroll and the parlay's tier
- Tier mapping from parlay data: `strategy_name` containing `floor_lock`/`optimal_combo` → execution (5%), `ceiling_shot` → exploration (1%), cross-sport → exploration (1%)
- For each customer, rebuild the message with their personalized `$stake→$payout` values replacing the bot's base amounts

**2. Ensure all broadcast types include per-customer stakes (lines 1854-1860)**
- Expand `tierStakePercent` to cover `new_strategies_broadcast` (default 5% for execution strategies, but we'll use per-parlay tier detection instead)
- For `new_strategies_broadcast`, generate a **customer-specific formatted message** by re-running `formatNewStrategiesBroadcast` with each customer's bankroll injected into the parlay data

**Implementation approach:**
- Pass `customerBankroll` as optional param to `formatNewStrategiesBroadcast`
- When present, override `simulated_stake` per parlay based on tier × bankroll percentage
- In the broadcast loop, call the formatter once per customer with their bankroll
- Tier detection: parse `strategy_name` → execution strategies get 5%, exploration get 1%, validation get 2.5%, lottery/ceiling get 0.5-1%

**3. Add `new_strategies_broadcast` to the personalization path in broadcast loop**
- Instead of the generic `💰 Your stake` append, regenerate the full message per customer

### Stake Tier Mapping (from strategy name)
```text
optimal_combo, floor_lock → execution (5%)
ceiling_shot, cross_sport → exploration (1%)
nhl_floor_lock, nhl_optimal_combo → execution (5%)
nhl_ceiling_shot → exploration (1%)
manual_curated → execution (5%)
```

### Files to Edit
- `supabase/functions/bot-send-telegram/index.ts` — personalize formatNewStrategiesBroadcast + broadcast loop

