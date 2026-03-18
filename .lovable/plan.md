

# Overhaul: Generate Wide, Rank, and Cap the Best 25

## The Core Idea

Instead of generating parlays and then voiding/swapping to fix exposure problems, flip the model:

1. **Generate 60-80 diverse parlays** with intentional variation — including contrarian flips (if Derrick White assists over appears 13 times, deliberately build some with him under)
2. **Score and rank all 80** using a composite quality metric
3. **Keep the top 25** — no voiding, no swapping, just selection

This eliminates the void problem entirely. The diversity comes from generation, not post-hoc cleanup.

## What Changes

### 1. `bot-quality-regen-loop/index.ts` — New "Generate Wide, Select Best" Model

Replace the current 3-attempt loop + exposure cap + swap logic with:

- **Phase A: Wide Generation** — Call `bot-generate-daily-parlays` with a `wide_mode: true` flag and higher profile count. Target ~80 raw parlays across all strategies.
- **Phase B: Contrarian Injection** — After initial generation, scan the pool for over-represented player+prop+side combos (e.g., "Derrick White assists over" appears 8 times). For the top 5 most repeated combos, generate 2-3 parlays with the **opposite side** using the same player. This creates scenario diversity.
- **Phase C: Composite Ranking** — Score each parlay on a weighted composite: `(combined_probability * 0.4) + (avg_leg_hit_rate * 0.3) + (diversity_bonus * 0.2) + (contrarian_bonus * 0.1)`. The diversity bonus rewards parlays with unique player combos not seen in higher-ranked selections. The contrarian bonus rewards flipped sides when the hit rate supports it.
- **Phase D: Select Top 25** — Take the top 25 by composite score. Mark the rest as `outcome: 'pool_unselected'` (not void — just not selected). No exposure cap needed because the ranking naturally distributes players across the top 25.

### 2. `bot-generate-daily-parlays/index.ts` — Add Contrarian Profile Support

Add new profile entries with `side: 'flip'` or `contrarian: true` flag:
- When this flag is set, the generator picks the **opposite** side from what the sweet spot recommends
- Only applied when the opposite side still has a reasonable hit rate (40%+)
- Creates intentional scenario diversity: "What if this player goes under instead?"

Add ~10 new contrarian profiles across exploration/execution:
```
{ legs: 3, strategy: 'contrarian_flip', sports: ['basketball_nba'], minHitRate: 40, sortBy: 'hit_rate', contrarian: true }
```

### 3. `bot-daily-diversity-rebalance/index.ts` — Simplify to Validation Only

Since the regen loop now handles selection, the rebalancer becomes a lightweight sanity check:
- Verify no player appears in more than 5 of the final 25 (safety net)
- Verify no single strategy exceeds 40% of the 25
- If violations exist, swap the lowest-ranked offender with the next-best unselected parlay from the pool

### 4. Remove Exposure Cap + Swap Logic from Regen Loop

The entire `EXPOSURE_CAP` / swap-not-void block (lines 261-403) is replaced by the ranking system. No need to swap legs — just pick better parlays from the pool.

## How Contrarian Flips Work

Example: Sweet spots say "Derrick White assists over 4.5" with 70% hit rate.
- **Standard parlays**: Include him as assists over (normal)
- **Contrarian parlays**: Include him as assists under 4.5 — because if he's in 13 parlays all over, having 2-3 under creates scenario coverage. The under might have 45% hit rate, which is fine for a diversification play.

The ranking phase will naturally sort these: if the over is genuinely better, those parlays rank higher. But the under versions exist as hedges in the final 25.

## Files Changed

| File | Change |
|------|--------|
| `bot-quality-regen-loop/index.ts` | Replace 3-attempt + exposure cap with wide-generate → rank → select-top-25 |
| `bot-generate-daily-parlays/index.ts` | Add ~10 contrarian profile entries + `contrarian: true` handling in leg assembly |
| `bot-daily-diversity-rebalance/index.ts` | Simplify to validation-only (safety net on final 25) |

## Expected Outcome

- **Zero voids** from exposure caps — selection replaces voiding
- **25 active parlays** daily with maximum scenario diversity
- **Contrarian coverage**: If a player dominates the pool in one direction, the opposite direction is represented too
- **Better accuracy**: Ranking by composite score (hit rate + probability + diversity) surfaces the genuinely best combos instead of whatever survives cap enforcement

