

## Pipeline Comparison: Automated Bot vs Manual Curation

### What the Automated Pipeline Generated Today (March 4)

| Strategy | Tier | Count | Avg Legs | Avg Prob |
|----------|------|-------|----------|----------|
| shootout_stack | execution | 12 | 3 | 33.2% |
| grind_stack | execution | 5 | 3 | 34.7% |
| mispriced_edge | exploration | 9 | 3 | 38.1% |
| mega_lottery_scanner | standard | 3 | 3 | 9.2% |
| mega_lottery_scanner | high_roller | 3 | 3.7 | 2.2% |
| mega_lottery_scanner | mega_jackpot | 3 | 3 | 0.7% |

### What We Did Manually

| Ticket | Legs | Prob | Key Difference |
|--------|------|------|----------------|
| Standard (3-leg) | 3 | 19.9% | Multi-engine consensus picks, 89-100% L10 hit rates |
| Mid-Tier (5-leg) | 5 | 5.8% | Pipeline never builds 5-leg tickets |
| High Roller (8-leg) | 8 | 0.6% | Pipeline never builds 8-leg tickets |
| Mega Jackpot (13-leg) | 13 | 0.03% | Pipeline max is 3-4 legs |

### Key Performance Data (Last 30 Days, 10+ sample)

| Strategy | Win Rate | Sample |
|----------|----------|--------|
| **double_confirmed_conviction** | **54.5%** | 11 |
| grind_stack | 36.4% | 77 |
| mispriced_edge (exploration) | 34.0% | 247 |
| cross_sport | 33.3% | 30 |
| shootout_stack | **16.0%** | 100 |
| force_mispriced_conviction | 20.7% | 150 |

### Critical Gaps Between Manual vs Pipeline

1. **Pipeline ignores L10 hit rate thresholds above 70%** — our manual picks required 80-100% L10. The pipeline's `hit_rate` field shows most legs at 66-74% (decimal) or a flat 70 (integer). Our manual picks like Isaiah Joe (100% L10) and Jared McCain (90% L10) would score much higher.

2. **Pipeline never stacks 5+ legs** — all automated parlays are 3-leg. Our best manual tickets were 5-leg and 8-leg with carefully role-stacked legs (SAFE/BALANCED/GREAT ODDS). The pipeline has no multi-tier ticket builder.

3. **Pipeline doesn't cross-reference engines** — `double_confirmed_conviction` is at 54.5% win rate (best strategy) but only 11 samples. The pipeline under-allocates to this strategy. Our manual process ran 5 separate engines and only picked consensus overlaps.

4. **Shootout stack is the worst performer at 16%** — yet it generated 12 parlays today (most volume). The pipeline over-allocates to its weakest strategy.

5. **No defense-rank filtering in practice** — `defense_rank` is mostly null in the data. Our manual process explicitly targeted rank 25-30 defensive targets.

### Proposed Fine-Tuning Plan

**Phase 1: Strategy Rebalancing**
- Reduce `shootout_stack` allocation from ~40% to 15% (or eliminate)
- Increase `double_confirmed_conviction` allocation from ~3% to 30%
- Add minimum L10 hit rate gate of 80% for execution tier legs
- Add defense rank requirement (must be rank 20+ for overs)

**Phase 2: Multi-Leg Ticket Builder**
- Add a new "role-stacked builder" module to `bot-generate-daily-parlays` that constructs 5-leg and 8-leg tickets using the SAFE/BALANCED/GREAT ODDS role system we used manually
- Select top legs from the 3-leg execution pool and combine them into structured multi-leg tickets
- Calculate combined odds via decimal multiplication (same as `manual-parlay-broadcast`)

**Phase 3: Multi-Engine Consensus Gate**
- Before finalizing execution-tier parlays, run each leg through a lightweight consensus check: does it appear in at least 2 of (sweet spots, mispriced lines, double-confirmed, high-conviction)?
- Legs with single-engine backing get downgraded to exploration tier
- Legs with 3+ engine consensus get priority placement

**Phase 4: Automated Manual-Style Pipeline**
- Create a new edge function `bot-curated-pipeline` that replicates our manual workflow:
  1. Query defense rankings for today's games
  2. Filter to PRIME targets (rank 25-30)
  3. Pull all props for players in those matchups
  4. Run through multi-engine validation
  5. Stack into 3/5/8/13-leg tickets with role assignments
  6. Insert and broadcast via existing `manual-parlay-broadcast`

### Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Modify | Rebalance strategy weights, add L10 80%+ gate, add defense rank filter |
| `supabase/functions/bot-curated-pipeline/index.ts` | Create | Automated version of our manual curation flow |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Modify | Add multi-leg ticket builder (5/8-leg role-stacked) |

