

## Test the Unified Environment Score Engine

We'll run live tests against both edge functions to verify the Environment Score is working correctly with the seeded data.

### Test 1: Prop Engine v2

Call `prop-engine-v2` with a rebounds prop to confirm it picks up the new environment score (using real opp_rebounds_rank data instead of the 0.5 neutral default).

### Test 2: Prop Engine v2 — Assists prop

Call with an assists prop to verify the assists-specific path uses `opp_assists_rank`.

### Test 3: Bot Generate Daily Parlays (dry run)

Invoke `bot-generate-daily-parlays` to see the environment_score appear in parlay leg breakdowns.

### What to look for

- `environment_score` field appears in the output/breakdown (not the old `blowout_pace_score`)
- REB/AST props show non-0.5 reb/ast environment values (confirming Phase 2 data is being used)
- Confidence adjustments are within the -20 to +20 range

