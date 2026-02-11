

# Run Team Props & Other Sports Through the Pipeline

## What's Already Working
The generator already has **30+ profiles** for team props (spreads, totals, moneylines) and multi-sport (NHL, NCAAB, tennis) across all three tiers. The pipeline already scrapes odds for NBA, NHL, WNBA, NCAAB, ATP, and WTA. Settlement already handles team legs (spreads via margin, totals via combined score, moneylines via winner).

## What Needs to Change

### 1. Expand Pipeline Coverage for All Sports
The `whale-signal-detector` and `track-odds-movement` currently miss some sports. Update the orchestrator to pass all supported sports to these functions so team props and other sports get the same sharp money and movement analysis as NBA.

### 2. Add Bankroll Floor Protection ($1,000 minimum)
Before generating parlays, the bot checks its current bankroll:
- At or below $1,000: pause generation entirely, log a protection event
- Below $1,200: skip exploration tier (reduce exposure, only run validation + execution)
- Settlement clamps bankroll so it never drops below $1,000 in the database

### 3. Add Team Prop Category Tracking to Calibration
Ensure `calibrate-bot-weights` creates and updates weight entries for team categories (SHARP_SPREAD, OVER_TOTAL, UNDER_TOTAL, ML_FAVORITE, ML_UNDERDOG) so the learning loop covers team props the same way it covers player props.

---

## Technical Details

### File: `supabase/functions/data-pipeline-orchestrator/index.ts`
- Update `track-odds-movement` call to include `['basketball_nba', 'icehockey_nhl', 'basketball_wnba', 'basketball_ncaab']`
- Update `whale-signal-detector` call to include `'basketball_ncaab'` in the sports array

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`
Add bankroll floor protection before pool building (around line 1768):

```
const BANKROLL_FLOOR = 1000;

if (bankroll <= BANKROLL_FLOOR) {
  // Log and return -- protect capital
  await supabase.from('bot_activity_log').insert({
    event_type: 'bankroll_floor_hit',
    message: `Bankroll at $${bankroll}. Generation paused to protect capital.`,
    severity: 'warning',
  });
  return Response with parlaysGenerated: 0, reason: 'bankroll_floor_protection';
}

// Reduce exposure if near floor
const isLowBankroll = bankroll < BANKROLL_FLOOR * 1.2;
if (isLowBankroll) {
  tiersToGenerate = tiersToGenerate.filter(t => t !== 'exploration');
}
```

### File: `supabase/functions/bot-settle-and-learn/index.ts`
Clamp bankroll at $1,000 floor during activation status update:

```
const BANKROLL_FLOOR = 1000;
const accumulatedBankroll = Math.max(
  BANKROLL_FLOOR,
  prevBankroll + datePnL.profitLoss
);
```

### File: `supabase/functions/calibrate-bot-weights/index.ts`
Ensure team categories are seeded in `bot_category_weights` if they don't already exist, so team prop performance feeds back into the next day's generation weights.

### Summary of Changes
- `data-pipeline-orchestrator/index.ts` -- expand sport coverage for odds movement and whale signals
- `bot-generate-daily-parlays/index.ts` -- bankroll floor gate
- `bot-settle-and-learn/index.ts` -- bankroll floor clamp
- `calibrate-bot-weights/index.ts` -- seed team prop categories into weight tracking

