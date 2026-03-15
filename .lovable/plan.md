

# Smart Stake Scaling Based on Active Parlay Count

## The Problem

Current light-slate logic reduces stakes by tier (execution stays full, validation halved, exploration quartered), but it doesn't know how many parlays will actually survive after diversity rebalancing. Today: 3 active parlays with $200 total exposure. On a normal day with 15-20 active parlays, the same $200 would be spread across many more independent bets — much better risk distribution.

With only 3 parlays, a single bad leg can wipe out a third of your slate. The stake sizes should reflect this reduced diversification.

## What to Change

### Add a post-rebalance stake adjustment in `bot-daily-diversity-rebalance/index.ts`

After the rebalance pass determines which parlays survive, count the active parlays and apply a **volume-aware stake multiplier**:

| Active Parlays | Multiplier | Rationale |
|---|---|---|
| 1-3 | 0.5× | Very concentrated — cut stakes in half |
| 4-6 | 0.75× | Still thin — reduce by 25% |
| 7-10 | 1.0× | Adequate diversification — normal stakes |
| 11+ | 1.0× | Full slate — no adjustment needed |

For today's 3 parlays, this would change:
- Execution: $100 → $50
- Exploration: $50 → $25 each
- Total exposure: $200 → $100

### Implementation

In `bot-daily-diversity-rebalance/index.ts`, after the void/keep pass completes:

1. Count surviving (non-voided) parlays
2. Determine the volume multiplier from the table above
3. Update `simulated_stake` and `simulated_payout` on all surviving parlays with the scaled values
4. Log the adjustment: `[Rebalance] Volume-scaled stakes: 3 active parlays → 0.5× multiplier`

### Why This Makes Sense

- **Fewer bets = less diversification = more risk per bet** — stakes should shrink to compensate
- The adjustment happens *after* all voiding is done, so it knows the true active count
- Execution tier still gets proportionally more than exploration (the tier ratios are preserved)
- On full slates (11+), nothing changes — zero impact on normal days

### What NOT to Change

- The `getDynamicStake` function in `bot-generate-daily-parlays` stays as-is (it handles generation-time sizing)
- Tier ratios remain the same (execution > validation > exploration)
- This only scales the magnitude, not the allocation strategy

