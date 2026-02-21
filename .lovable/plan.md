

## Exclude Single-Pick Exploration Strategies from Integrity Check

### The Problem

The integrity check flags ALL 1-leg and 2-leg parlays as violations, including the `max_boost_exploration_single_pick_accuracy` and `max_boost_exploration_single_pick_value` strategies. These are intentionally single-leg entries used for tracking individual pick performance -- not real parlays. They trigger false alerts via Telegram every run.

### The Fix

One surgical change in `supabase/functions/bot-parlay-integrity-check/index.ts`: after querying for 1-leg and 2-leg parlays (line 38-42), filter out the two exploration strategies before counting violations.

### Code Change

After the query on line 42, add a filter to exclude the known single-pick exploration strategies:

```
// Exclude intentional single-pick exploration strategies
const EXCLUDED_STRATEGIES = [
  'max_boost_exploration_single_pick_accuracy',
  'max_boost_exploration_single_pick_value',
];

const realViolations = (violations || []).filter(
  p => !EXCLUDED_STRATEGIES.includes(p.strategy_name)
);
```

Then use `realViolations` instead of `violations` for all downstream logic (counting one-leg/two-leg, building strategy breakdowns, deciding whether to fire the Telegram alert).

The excluded strategies will still be logged in the metadata for transparency but won't trigger alerts.

### Impact

- No more false Telegram integrity alerts from exploration strategies
- Real violations (unexpected 1-leg or 2-leg parlays from other strategies) still trigger alerts as before
- Zero impact on parlay generation or any other function

