

## Tightening the "Out of Place" Line Intelligence

### Current Gaps in `detect-mispriced-lines`

After reviewing the full 1114-line engine, here's what it does well and what's missing:

**What it already does:**
- L10/L20/L3/L5 averages vs book line → edge_pct
- Defense rank multiplier adjusts projections
- Team total alignment (OVER/UNDER game total boosts/penalizes)
- L3 recency gate (confirms or dampens edge)
- Confidence tiering (ELITE/HIGH/MEDIUM/LOW)
- 15% edge threshold to flag as "mispriced"

**What's missing — 5 intelligence upgrades I'd recommend:**

### 1. Variance/Consistency Filter
Right now a player averaging 25 PTS with games of [35, 15, 35, 15, 25, 35, 15, 25, 35, 15] and one averaging [24, 26, 25, 24, 26, 25, 24, 26, 25, 24] both show the same edge. The consistent player is far more reliable. Add a **coefficient of variation** (stdDev / mean) — high variance players get their edge dampened by 20-40%.

### 2. Historical Hit-Rate Cross-Reference
The engine calculates edge purely from averages but never checks: "Has this player actually cleared this line consistently?" A player with L10 avg of 28 on a 24.5 line looks great, but if 4 of those games were 40+ and 6 were under 24, the hit rate is only 40%. Cross-reference `category_sweet_spots` L10 hit rate — if hit rate < 60%, dampen the edge by 30%.

### 3. Minutes Stability Check
An edge means nothing if the player's minutes are volatile. A player averaging 8 assists on 36 MPG but whose last 3 games were 22, 18, 25 minutes (coach rotation, blowouts) has a false edge. Add a **minutes volatility check** from game logs — if L3 minutes < 80% of L10 minutes average, flag as unreliable and dampen edge by 25%.

### 4. Line Movement Consensus (Cross-Book)
Currently uses a single book's line. If FanDuel has Player X O 24.5 PTS but DraftKings and BetMGM have 26.5, FanDuel is the outlier — that's a real mispricing. If all books agree at 24.5, the "edge" is just the player being good, not a mispricing. Add a **cross-book line comparison** from `unified_props` — calculate consensus line across bookmakers and boost edge when a single book deviates significantly from consensus.

### 5. Outcome Feedback Loop
The engine never learns from its own track record. Yesterday's mispriced picks that hit should boost confidence in similar patterns; misses should dampen them. Cross-reference `mispriced_lines` from the last 14 days against settlement outcomes to calculate a **prop-type accuracy rate** — apply a multiplier (0.8x to 1.2x) to edge_pct based on recent accuracy for that prop type.

---

### Recommended Priority

I'd suggest implementing **all 5** in the existing `detect-mispriced-lines` function:

**File: `supabase/functions/detect-mispriced-lines/index.ts`**

1. **Variance filter** (~15 lines) — Calculate stdDev of L10 values, compute CV, apply dampening multiplier to `edgePct` when CV > 0.35
2. **Hit-rate cross-ref** (~20 lines) — Bulk-fetch today's `category_sweet_spots` for same players, if L10 hit rate < 60% dampen edge by 30%
3. **Minutes stability** (~15 lines) — Compare L3 avg minutes to L10 avg minutes from existing game logs (already fetched), dampen if ratio < 0.80
4. **Cross-book consensus** (~25 lines) — Group `unified_props` by player+prop_type across bookmakers, calculate median line, boost edge when book line deviates > 1.0 from consensus
5. **Outcome feedback** (~25 lines) — Fetch last 14 days of `mispriced_lines` with known outcomes, calculate per-prop-type accuracy, apply 0.8-1.2x multiplier

Each upgrade adds a field to `shooting_context` for transparency (e.g., `variance_cv`, `historical_hit_rate`, `minutes_stability`, `consensus_line`, `feedback_multiplier`).

Total: ~100 lines added to the existing function. No new tables, no new edge functions — just smarter scoring in the same pipeline.

