

# Fix Settlement Pipeline and Telegram Notifications

## Issues Found

### 1. Generation notification type mismatch (SILENT FAILURE)
`bot-generate-daily-parlays` sends type `tiered_parlays_generated` (line 1350), but `bot-send-telegram` only handles `parlays_generated` in its switch statement (line 39). This means generation notifications fall through to the `default` case and send a raw JSON dump instead of the formatted message.

**Fix:** Add `tiered_parlays_generated` as a recognized type in `bot-send-telegram/index.ts` and create a proper formatter that shows tier breakdown (Exploration/Validation/Execution counts).

### 2. Settlement notification missing weight changes and strategy
`bot-settle-and-learn` sends the settlement Telegram notification (line 542-568) with win/loss stats, but does NOT include:
- `weightChanges` array (even though `formatSettlement` in `bot-send-telegram` already has rendering code for it)
- Active strategy details or next-day recommendations

**Fix:** Collect weight change deltas during the learning loop in `bot-settle-and-learn` and pass them in the Telegram payload. Also query and include the active strategy name and its current win rate.

### 3. No next-day strategy info in settlement message
The settlement Telegram message doesn't tell the user what strategy the bot will use tomorrow or any adjustments.

**Fix:** Add a "Tomorrow's Strategy" section to the settlement message showing the active strategy name, current win rate, and any categories that were blocked/unblocked during this settlement.

---

## Changes

### File 1: `supabase/functions/bot-send-telegram/index.ts`

- Add `tiered_parlays_generated` to the `NotificationType` union type
- Add it to the `switch` statement, mapping to a new `formatTieredParlaysGenerated()` function
- New formatter shows tier counts, pool size, and date in a clean Telegram message
- Update `formatSettlement()` to include a "Tomorrow's Strategy" section showing the active strategy and any blocked/unblocked categories

### File 2: `supabase/functions/bot-settle-and-learn/index.ts`

- During the weight update loop (step 4, lines 277-314), collect weight change deltas into an array
- After settlement, query the active strategy from `bot_strategies`
- Query newly blocked/unblocked categories
- Include `weightChanges`, `strategyName`, `strategyWinRate`, and `blockedCategories` in the Telegram notification payload (step 10, lines 542-568)

---

## Technical Details

### New Telegram notification type
```typescript
// bot-send-telegram - add to NotificationType
| 'tiered_parlays_generated'

// New formatter
function formatTieredParlaysGenerated(data, dateStr) {
  // Shows: total count, tier breakdown, pool size
}
```

### Settlement payload additions
```typescript
// bot-settle-and-learn - enhanced Telegram data
{
  type: 'settlement_complete',
  data: {
    parlaysWon, parlaysLost, profitLoss,
    consecutiveDays, bankroll, isRealModeReady,
    // NEW:
    weightChanges: [{ category, oldWeight, newWeight, delta }],
    strategyName: strategy?.name,
    strategyWinRate: strategy?.win_rate,
    blockedCategories: ['REBOUNDS_over', ...],
    unblockedCategories: [],
  }
}
```

### Updated settlement Telegram message format
```text
DAILY SETTLEMENT REPORT
Yesterday: Feb 10
Result: 12/68 parlays hit (18%)
P/L: -$2,800 (simulation)
Bankroll: $1,000 -> -$1,800

Tomorrow's Strategy
Active: elite_categories_v1
Win Rate: 22%
Blocked: REBOUNDS_over, STEALS_under

Weight Changes:
 POINTS_over: 1.00 -> 0.97
 ASSISTS_over: 1.02 -> 1.04
```

### Deployment
Both `bot-send-telegram` and `bot-settle-and-learn` edge functions will be redeployed.
