## Cascade Alert Simulation Panel

Add a lightweight bankroll-impact simulator appended to cascade alert Telegram messages so users can see expected $ outcomes for TAIL (small), TAIL (full), and FADE — derived directly from the verdict mix already on the alert.

### What it does

Right after the existing `🎯 Action:` header in the cascade Telegram message, render a compact 4-line "💰 Sim" block:

```
💰 Sim ($100 bankroll, -110 legs)
  TAIL full (5-leg):  p=8%   EV=-$22   Risk: $2 → win $48
  TAIL small (top 3): p=32%  EV=+$4    Risk: $1 → win $5
  FADE (opposite):    p=68%  EV=+$28   Risk: $3 → win $4
```

Numbers are illustrative — actual values come from the formulas below.

### How probabilities are derived (no new data fetch)

We already have `verdict_counts {strong, lean, weak}` and per-leg `engine_reasoning` on `metadata`. Map each leg to a single-leg hit probability:

- STRONG → 0.62
- LEAN → 0.52
- WEAK → 0.42

(These mirror the calibration buckets already used in `mem/logic/alerts/explainer-contract.md` verdict thresholds; tuned conservatively so WEAK is sub-coinflip.)

Then:

- **TAIL full** = product of all leg probs (parlay hit rate)
- **TAIL small** = product of top-3 STRONG/LEAN legs only (skip if <3 non-weak legs → mark "n/a")
- **FADE** = `1 - (product of leg probs treated as independent under-hits)`, i.e. probability that at least one leg busts. For all-WEAK cascades this is high, matching the existing FADE bait detection.

### Stake sizing

Reuse the existing `suggestedStake(confidence, americanOdds, bankroll)` helper from `supabase/functions/_shared/edge-calc.ts` (half-Kelly, capped 3%). Default bankroll = $100, default odds = -110 per leg, parlay odds computed by multiplying decimal odds.

If Kelly returns 0 (negative EV), show `Risk: $0 — skip`.

### Files to change

1. **`supabase/functions/_shared/cascade-sim.ts`** (new) — pure function `buildCascadeSim(verdictCounts, legs, bankroll=100)` returning `{ tailFull, tailSmall, fade }` each with `{ prob, ev, stake, payout }`. Unit-testable, no IO.

2. **`supabase/functions/signal-alert-telegram/index.ts`** — after the Action header block, call `buildCascadeSim(...)` and append the 4-line Sim block. Guarded so non-cascade alerts and alerts missing `verdict_counts` skip rendering. Respects existing 3500-char ceiling — if over budget, drop the Sim block first (Action header is higher priority).

3. **`supabase/functions/_shared/cascade-sim.test.ts`** (new) — 5 Deno tests per the project testing-policy memory:
   - All-STRONG 3-leg cascade → TAIL full positive EV
   - All-WEAK 5-leg cascade → FADE positive EV, TAIL full near 0
   - Mixed 2S/2L/1W → TAIL small picks the 3 non-weak
   - Empty verdict_counts → returns null (caller skips render)
   - Bankroll=0 edge case → all stakes 0, no NaN

4. **`mem/logic/alerts/cascade-sim-panel.md`** (new memory) — documents the prob mapping (STRONG=0.62 / LEAN=0.52 / WEAK=0.42), bankroll defaults, and that this is a display aid, not a new signal.

5. **`mem/index.md`** — add memory reference line.

### Non-goals

- No new DB columns, no new alert types, no UI changes outside Telegram.
- Does not influence the Action verdict — purely a $ visualization of the existing verdict.
- No per-user bankroll yet (uses fixed $100); can wire to `bankroll_settings` table in a follow-up if you want it personalized.

### Deployment

Redeploy `signal-alert-telegram` after edits. Verify with one live cascade alert in the Telegram channel.