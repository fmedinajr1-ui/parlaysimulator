

# Fix Slate Status Update — Only Show Active Parlays on Telegram

## Problem
The `bot-slate-status-update` queries ALL 107 parlays for today and sends the full count (101 voided + 6 active) to Telegram. The message prominently displays "🚫 VOIDED: 101 parlays" which is confusing — users only care about the active slate.

## Changes

### 1. `bot-slate-status-update/index.ts` — Filter query to pending only
Change the DB query (line 22-25) to only fetch `pending` parlays:
```typescript
const { data: parlays } = await supabase
  .from('bot_daily_parlays')
  .select('*')
  .eq('parlay_date', today)
  .eq('outcome', 'pending');
```

Remove the voided parlay logic entirely (lines 38-55) — no need to count or report voided parlays. The message should focus on what's live.

### 2. Simplify the Telegram payload
Send only active parlays to `bot-send-telegram`:
```typescript
body: {
  type: 'slate_status_update',
  data: {
    activeParlays: formattedActive,
    totalStake: totalStakeSum,  // sum of simulated_stake for active parlays
  },
}
```

### 3. `bot-send-telegram/index.ts` — Clean up `formatSlateStatusUpdate`
Remove the "🚫 VOIDED" section (lines 424-431). Update the header to show only active count and total daily risk:
```
📋 DAILY SLATE STATUS — Mar 04
━━━━━━━━━━━━━━━━━━━━━━
✅ 6 ACTIVE PARLAYS | Total Risk: $295

Parlay #1 (elite categories v1 execution) — 3 legs
 Take Player OVER 5.5 3PT (80% L10)
 ...
```

This way Telegram shows exactly what's live and the total dollar exposure for the day.

