
# Verification Results + Two Follow-Up Fixes

## What Was Verified

The UI code is correctly implemented:

- **Stake badge in header** (line 99-102): The styled `bg-primary/15` pill with `DollarSign` icon and `{parlay.simulated_stake || 10}` is live and rendering on every card.
- **Expanded stake plan row** (lines 118-127): The `Bet $X → To win $Y · tier tier` bar is present in the `CollapsibleContent` above the legs list.
- **`tier?: string`** is added to the `BotParlay` interface at line 70 of `useBotEngine.ts`.

The code changes are all correct and complete.

---

## Two Problems Found in Live Data

### Problem 1: "To win $0" on Every Expanded Card

Every parlay in today's board has `simulated_payout = null` in the database. The `expected_odds` column IS populated (+264 for 2-leg, +596 for 3-leg), but the payout was never calculated and stored.

The expanded card currently shows:
```
$ Bet $50     To win $0     exploration tier
```

**Root cause:** The generator writes `expected_odds` as American odds (e.g. +264) but never converts that to a dollar payout and stores it in `simulated_payout`. The settlement function writes `simulated_payout` after a win, but for pending parlays it remains null.

**Fix option A (recommended — frontend only):** Compute the payout on the fly from `expected_odds` and `simulated_stake` in `BotParlayCard.tsx`:

```ts
// American odds to payout calculation
function computePayout(stake: number, americanOdds: number): number {
  if (americanOdds > 0) return stake + (stake * americanOdds / 100);
  return stake + (stake * 100 / Math.abs(americanOdds));
}
```

Then in the expanded row, replace `parlay.simulated_payout || 0` with:
```ts
parlay.simulated_payout || computePayout(parlay.simulated_stake || 10, parlay.expected_odds || 0)
```

This requires adding `expected_odds?: number` to the `BotParlay` interface in `useBotEngine.ts`.

### Problem 2: 5 Single-Leg Parlays Still Visible (Pre-Deploy Leftovers)

Today's board has:
- 5 × 1-leg parlays (from the pre-deploy run at 10:03 AM)
- 40 × 2-leg mini-parlays
- 7 × 3-leg parlays

The new `< 3` threshold is deployed and working but the stale 1-leg picks from before the deploy are still sitting in the DB. The mini-parlay flood (40 of them) also remains from the pre-deploy run.

**Fix:** Trigger a fresh generation from the Dashboard (Smart Generate or Gen button) to clear today's stale board and produce a clean run under the new rules. The new run will skip single picks (since 7 standard parlays > 3 threshold) and keep mini-parlays capped at 6.

---

## Plan

### File 1: `src/hooks/useBotEngine.ts`
Add `expected_odds?: number` to the `BotParlay` interface (1 line after line 68).

### File 2: `src/components/bot/BotParlayCard.tsx`
Two targeted changes:

**A — Add `computePayout` helper** above the component (after `formatOdds`):
```ts
function computePayout(stake: number, americanOdds: number): number {
  if (!americanOdds || !stake) return 0;
  if (americanOdds > 0) return stake + (stake * americanOdds / 100);
  return stake + (stake * 100 / Math.abs(americanOdds));
}
```

**B — Replace the "To win" value** in the expanded stake plan row (line 124):
```ts
// BEFORE:
<span>To win <span className="text-green-400 font-semibold">${(parlay.simulated_payout || 0).toFixed(0)}</span></span>

// AFTER:
<span>To win <span className="text-green-400 font-semibold">
  ${(parlay.simulated_payout || computePayout(parlay.simulated_stake || 10, parlay.expected_odds || 0)).toFixed(0)}
</span></span>
```

This means:
- Settled/won parlays → use the actual stored `simulated_payout` (accurate)
- Pending parlays → compute from `expected_odds` × `simulated_stake` (estimated but correct)

For a $50 stake at +264 odds → **To win $182**. For $20 at +596 → **To win $139**.

No database migration required. No new dependencies. After the code change, hit **Smart Generate** in the Dashboard to clear the stale 1-leg board.
