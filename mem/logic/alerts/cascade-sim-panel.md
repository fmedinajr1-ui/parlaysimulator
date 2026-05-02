---
name: Cascade alert bankroll sim panel
description: Telegram cascade alerts append a $100-bankroll TAIL/FADE simulation block derived from verdict_counts; display aid only, never gates the Action verdict
type: feature
---

`supabase/functions/_shared/cascade-sim.ts` powers a 4-line "💰 Sim" block rendered right after the `🎯 Action:` header on cascade Telegram messages. It is a **display aid only** — it does not influence which Action (TAIL/FADE/SKIP) is shown.

Per-leg hit probability mapping (independent legs, simplified):
- STRONG → 0.62
- LEAN → 0.52
- WEAK → 0.42

Three outcomes simulated:
- **TAIL full** = product of all leg probs at parlay -110^N decimal odds.
- **TAIL small** = product of top-3 STRONG/LEAN legs. Renders `n/a` if fewer than 3 non-WEAK legs.
- **FADE** = `1 - tailFull` priced at single -110 (simulating "any leg misses").

Stake = half-Kelly capped at 3% of bankroll, default bankroll $100. Negative-EV → `Risk: $0 — skip`.

If `verdict_counts` is missing/empty the sim is skipped entirely (returns null). Errors are non-fatal — the alert still renders. Sim block is dropped first if message exceeds 3500-char Telegram budget.

Tests: `supabase/functions/_shared/cascade-sim.test.ts` (5 cases per testing-policy memory).
