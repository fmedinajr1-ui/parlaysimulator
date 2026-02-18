
# Two Bugs Found: Single-Pick Flood + Telegram Fake Stakes

## Root Cause 1: Single-Pick Fallback Has Wrong Threshold

The approved fix lowered the **mini-parlay** gate from `< 12` to `< 6` (line 5029). But there is a **separate gate** on line 5314 for single-leg straight bets:

```ts
// Line 5314 — NOT changed in last deploy
if (allParlays.length < 10) {
  // generates 1-leg picks
}
```

Today's 5:45 PM run generated **5 standard parlays**. Since 5 < 6, mini-parlays were (correctly) skipped. But since 5 < 10, the **single-pick fallback fired** and added 5 more 1-leg bets. That is every parlay in the Telegram screenshot showing `(1-leg)`.

**Fix:** Change the single-pick fallback threshold from `< 10` to `< 3` — same philosophy as the mini-parlay fix. Single-leg straight bets should only exist on catastrophically thin slates (fewer than 3 parlays total), not as padding whenever the board sits at 5-9 standard parlays.

---

## Root Cause 2: Telegram Shows `$0 stake` — Hardcoded Labels

In `supabase/functions/telegram-webhook/index.ts` lines 562-566, the tier stake labels are **hardcoded strings** that ignore the actual `simulated_stake` value stored on each parlay:

```ts
// CURRENT — always shows $0 stake regardless of real stake
const tierStakes: Record<string, string> = {
  exploration: '$0 stake',       // ← hardcoded
  validation: 'simulated',       // ← hardcoded
  execution: 'Kelly stakes',     // ← hardcoded
};
```

The database already has the correct stake on every parlay (`simulated_stake: 25`, `50`, `300`, etc.). The formatter just never reads it.

**Fix:** Replace the hardcoded `tierStakes` label with a dynamic calculation that reads the actual `simulated_stake` from the parlays in the group. The tier header will show the real dollar amount from the database:

```ts
// NEW — reads actual stake from the first parlay in the group
const tierStake = group[0]?.simulated_stake ? `$${group[0].simulated_stake} stake` : 'simulated';
```

---

## What Each Change Fixes

| Issue | File | Change |
|---|---|---|
| 1-leg parlays appearing | `bot-generate-daily-parlays/index.ts` line 5314 | `< 10` → `< 3` |
| `$0 stake` in Telegram | `telegram-webhook/index.ts` lines 562-566 | Replace hardcoded labels with real `simulated_stake` from DB |

---

## Technical Details

### File 1: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Line 5314** — single-pick fallback gate:
```ts
// BEFORE:
if (allParlays.length < 10) {

// AFTER:
if (allParlays.length < 3) {
```

This means single-leg bets only generate when the bot has produced literally 0, 1, or 2 real parlays — a true emergency. Any slate that produces 3+ standard parlays will skip single picks entirely.

### File 2: `supabase/functions/telegram-webhook/index.ts`

**Lines 562-574** — replace hardcoded `tierStakes` block:
```ts
// BEFORE:
const tierStakes: Record<string, string> = {
  exploration: '$0 stake',
  validation: 'simulated',
  execution: 'Kelly stakes',
};
// ...
message += `${tierLabels[tier]} (${group.length}) — _${tierStakes[tier]}_\n\n`;

// AFTER:
// (remove tierStakes object entirely)
// In the loop:
const tierStake = group[0]?.simulated_stake
  ? `$${group[0].simulated_stake} stake`
  : 'simulated';
message += `${tierLabels[tier]} (${group.length}) — _${tierStake}_\n\n`;
```

Both functions are redeployed automatically after changes.

---

## What Telegram Will Look Like After Fix

```
🎯🔥 TODAY'S PARLAYS 🔥🎯

💰 Execution (3) — $300 stake

  1. 🎲 (3-leg) +750 ⏳
     📊 Take UConn -15.5 (-115)
     📊 LeBron O25.5 pts (-110)
     ...

✅ Validation (5) — $150 stake

🔬 Exploration (4) — $50 stake
```

No more `$0 stake` or 1-leg entries filling the board.
