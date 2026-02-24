

## Auto-Double Stakes After Profitable Days

### Overview
After each day's parlays are settled, the system will check if the day was profitable. If net profit > $0, it automatically doubles all tier stakes in `bot_stake_config` for the next day's generation. If the day was a loss, stakes reset to baseline defaults.

### How It Works

```text
Settlement runs (bot-settle-and-learn)
         |
         v
  Check yesterday's net P&L
  from bot_daily_parlays
         |
    Profitable?
    /        \
  YES         NO
   |           |
Double all    Reset to
stakes in     baseline
bot_stake_    defaults
config
```

### Changes

#### 1. Add columns to `bot_stake_config` (Database Migration)
- `streak_multiplier` (numeric, default 1.0) -- tracks the current multiplier
- `baseline_execution_stake`, `baseline_validation_stake`, `baseline_exploration_stake` -- stores the "normal" stakes so we can reset after a losing day
- `last_streak_date` -- prevents double-processing the same day

#### 2. Modify `bot-settle-and-learn` Edge Function
At the end of settlement (after all parlays are graded), add a new section:

- Query `bot_daily_parlays` for yesterday's settled results
- Sum `profit_loss` to get net P&L
- If net P&L > 0:
  - Set `streak_multiplier = 2.0`
  - Update `execution_stake = baseline_execution_stake * 2`
  - Update `validation_stake = baseline_validation_stake * 2`
  - Update `exploration_stake = baseline_exploration_stake * 2`
  - Update `bankroll_doubler_stake = baseline * 2`
  - Log: "Profitable day detected, stakes doubled for tomorrow"
- If net P&L <= 0:
  - Reset `streak_multiplier = 1.0`
  - Reset all stakes back to baseline values
  - Log: "Loss day, stakes reset to baseline"
- Update `last_streak_date` to prevent re-processing

#### 3. Populate baseline values (Migration)
- Copy current stake values into the new baseline columns so the system has a reference point to reset to

#### 4. Admin visibility in StakeConfigPanel
- Show the current `streak_multiplier` as a badge (e.g., "2x ACTIVE" in green or "1x Normal")
- Display whether yesterday was profitable and the auto-adjustment that was made
- Allow manual override to reset the multiplier back to 1x

### Safety Guards
- Cap the multiplier at 2x (no compounding day after day -- it resets to baseline then doubles, not double-on-double)
- Only triggers after settlement completes (not during)
- `last_streak_date` prevents duplicate processing
- Admin can always manually override via the Stake Override Panel
