
# Change Bot Stake from $10 to $20

## What Changes
Update the flat stake amount from $10 to $20 across all three generation tiers (exploration, validation, execution) and the fallback default.

## File to Edit
**`supabase/functions/bot-generate-daily-parlays/index.ts`**

4 lines to update:
- Line 66: `stake: 10` to `stake: 20` (exploration tier)
- Line 147: `stake: 10` to `stake: 20` (validation tier)  
- Line 187: `stake: 10` to `stake: 20` (execution tier)
- Line 2707: fallback default `config.stake : 10` to `config.stake : 20`
- Line 2706: comment update to reflect "$20"

## Impact
- All parlays generated tomorrow will use $20 stakes
- Payout calculations double accordingly (e.g., a +300 parlay pays $80 instead of $40)
- Bankroll floor protection ($1,000 minimum) still applies -- the system will pause generation if bankroll drops to that level
- Settlement pipeline picks up `simulated_stake` from each parlay record, so no changes needed there
