

# Fix Hardcoded $10 Stakes Across Codebase

## Problem

Your `bot_stake_config` table correctly shows $500 (execution), $200 (validation), $75 (exploration), but there are **6 hardcoded $10 references** that bypass the config entirely.

## Locations to Fix

### 1. `supabase/functions/bot-force-fresh-parlays/index.ts` (line 369)
- `simulated_stake: 10` -- hardcoded for force-generated parlays
- **Fix**: Read from `bot_stake_config.execution_stake` (since these are tier: 'execution')

### 2. `supabase/functions/bot-generate-daily-parlays/index.ts` (lines 7380-7381, 7425-7426)
- Monster parlays hardcode `simulated_stake: 10` and `simulated_payout: 10 * decimalOdds`
- **Fix**: Use `bot_stake_config.exploration_stake` (monster parlays are lottery-tier) for both conservative and aggressive monsters

### 3. `supabase/functions/telegram-webhook/index.ts` (line 383)
- ROI calculation: `totalStaked = settled.length * 10` -- assumes $10 per parlay
- **Fix**: Sum actual `simulated_stake` from each settled parlay: `settled.reduce((sum, p) => sum + (p.simulated_stake || 10), 0)`

### 4. `src/pages/Suggestions.tsx` (lines 936, 1151, 1227, 1335)
- UI shows "$10 Wins" label with $10 payout math in 4 places
- **Fix**: Change label to "$100 Wins" and update math to use $100 as the display stake (consistent with ManualParlayPanel which already uses $100)

### 5. `src/components/home/HomepageAnalyzer.tsx` (line 357)
- Shows "$10 Pays" label
- **Fix**: Change to "$100 Pays" and update the payout calculation accordingly

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/bot-force-fresh-parlays/index.ts` | Fetch `bot_stake_config` and use `execution_stake` instead of hardcoded 10 |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Replace monster parlay `simulated_stake: 10` with the loaded stake config value |
| `supabase/functions/telegram-webhook/index.ts` | Sum actual `simulated_stake` per parlay instead of `count * 10` |
| `src/pages/Suggestions.tsx` | Change all 4 "$10 Wins" labels and math to "$100 Wins" |
| `src/components/home/HomepageAnalyzer.tsx` | Change "$10 Pays" to "$100 Pays" |

## Notes

- The main parlay generation loop (line 6840-6855) already correctly reads `config.stake` from `TIER_CONFIG`, which gets overridden by `bot_stake_config` at startup -- that path is fine
- The Telegram `/start` welcome message (line 2769) says "Stake $10-$20 per parlay" -- this is user-facing guidance for subscribers' own bets, not the bot's internal stakes, so it can stay or be updated separately
