

# Fix: Stop Baseball Validation from Running on NBA Games

## Problem
The "Run Production Validation Gate" in `fanduel-behavior-analyzer` checks for batter hitting props and pitcher K props on **every** team news shift — including NBA games. This produces nonsensical output like "Batters: no hitting props found | Pitcher: no pitcher K props found" on NBA alerts (e.g., Portland Trail Blazers @ Phoenix Suns).

## Root Cause
Lines 514-605 of `fanduel-behavior-analyzer/index.ts` — the baseball-specific validation gate has no sport guard. It runs unconditionally for all `isTeamWide` correlation signals.

## Fix

### File: `supabase/functions/fanduel-behavior-analyzer/index.ts`

Wrap the Run Production Validation Gate (batter + pitcher checks) in a sport check so it only runs for MLB/baseball games:

```typescript
// === RUN PRODUCTION VALIDATION GATE (MLB ONLY) ===
const isMLB = (sampleShift.sport || '').toLowerCase().includes('baseball') 
           || (sampleShift.sport || '').toLowerCase().includes('mlb');

if (isMLB) {
  // ... existing batter and pitcher validation code ...
} else {
  // Non-baseball sports skip batter/pitcher validation entirely
  batterValidation.summary = '';
  pitcherValidation.summary = '';
}
```

Also update the alert payload to only include `batter_validation` and `pitcher_validation` fields when the sport is MLB — so NBA Telegram messages won't show "Batters: no hitting props found".

### Telegram message cleanup
In the alert object construction (lines 607-631), conditionally include the batter/pitcher summaries:

```typescript
...(isMLB && batterValidation.summary ? { batter_validation: batterValidation.summary } : {}),
...(isMLB && pitcherValidation.summary ? { pitcher_validation: pitcherValidation.summary } : {}),
```

This is a single-file fix with no database changes needed.

