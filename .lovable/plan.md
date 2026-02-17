

# Ultimate Adaptive Intelligence Engine

## The Vision
Transform the current scattered calibration scripts into a unified, self-optimizing intelligence system that continuously evaluates every decision it makes and rewires itself to maximize accuracy. This is the "money printer" -- an AI that gets smarter with every bet it settles.

## What's Missing Today

The current system has 6 separate adaptation scripts that each adjust one narrow dimension:
- `calibrate-bot-weights` -- recalculates category weights from all-time data (no recency bias)
- `bot-settle-and-learn` -- nudges weights by fixed +0.02/-0.03 per outcome
- `bot-evolve-strategies` -- retires/boosts strategies weekly (coarse, slow)
- `bot-review-and-optimize` -- detects hot/cold patterns (doesn't act on them dynamically)
- `autoFlipUnderperformingCategories` -- flips sides when over < 50% (binary, no nuance)
- `recalibrate-sharp-signals` -- tunes sharp thresholds (isolated from main pipeline)

**Critical gaps:**
1. All outcomes weighted equally -- a miss from 6 months ago counts the same as yesterday's miss
2. No regime detection -- doesn't know when market conditions shift (playoff mode, injury waves, etc.)
3. No confidence intervals -- treats a 60% hit rate from 10 samples the same as from 200 samples
4. No cross-category learning -- doesn't know that when 3PT shooting drops, rebounds tend to spike
5. No intra-day adaptation -- waits until next day to learn from morning results
6. No automatic tier restructuring -- execution tier stays at 3 legs even if 2-leg parlays are crushing

## The New System: `bot-adaptive-intelligence`

A single edge function that replaces the fragmented approach with a unified adaptive engine running as part of every pipeline cycle.

### Architecture

```text
                     PIPELINE TRIGGER
                           |
                           v
              +---------------------------+
              | bot-adaptive-intelligence  |
              +---------------------------+
              |                           |
              |  1. RECENCY ANALYZER      |   -- Exponential decay weighting
              |  2. REGIME DETECTOR       |   -- Market condition classification  
              |  3. BAYESIAN CALIBRATOR   |   -- Confidence-weighted adjustments
              |  4. CORRELATION MAPPER    |   -- Cross-category edge detection
              |  5. TIER OPTIMIZER        |   -- Dynamic profile restructuring
              |  6. GATE TUNER           |   -- Auto-adjust quality thresholds
              |  7. ADAPTATION WRITER     |   -- Writes all changes atomically
              |                           |
              +---------------------------+
                           |
                           v
              bot_adaptation_state (new table)
              bot_category_weights (updated)
              bot_strategies (updated)
```

### Module 1: Recency-Weighted Learning

Instead of treating all historical outcomes equally, apply exponential decay so recent results matter more.

- **Half-life**: 14 days (a result from 2 weeks ago counts 50%, 4 weeks ago counts 25%)
- **Formula**: `recencyWeight = Math.pow(0.5, daysSinceOutcome / HALF_LIFE)`
- **Impact**: Category weights shift faster when recent performance diverges from historical averages
- Stored as `recency_hit_rate` alongside `current_hit_rate` in `bot_category_weights`

### Module 2: Regime Detection

Classify each day's market into a "regime" so the engine knows which playbook to use.

- **Regimes detected**: 
  - `full_slate` (NBA + NHL + NCAAB all active, 8+ games)
  - `light_slate` (1-2 sports, < 6 games)
  - `playoff_mode` (postseason games detected)
  - `injury_storm` (5+ key players OUT across slate)
  - `chalk_day` (favorites covering at 65%+ over trailing 3 days)
  - `upset_wave` (underdogs covering at 55%+ over trailing 3 days)
- Each regime has its own optimal weight multipliers learned from historical data
- Stored in new `bot_adaptation_state` table with `regime`, `regime_weights` (JSONB), and `regime_accuracy`

### Module 3: Bayesian Confidence Calibrator

Replace raw hit rates with Bayesian-adjusted estimates that account for sample size uncertainty.

- **Prior**: League-wide average hit rate for the category type (e.g., player props = 52%, team totals = 50%)
- **Formula**: `bayesianRate = (prior * priorStrength + hits) / (priorStrength + totalPicks)`
  - `priorStrength` = 20 (equivalent to 20 "virtual" samples at the prior rate)
- **Effect**: New categories with 3/3 hits (100%) get pulled toward 60-65% instead of being wildly overweighted
- Categories with 200+ samples converge to their true rate with minimal prior influence
- Written as `bayesian_hit_rate` in `bot_category_weights`

### Module 4: Cross-Category Correlation Mapper

Detect when categories move together (or inversely) to exploit hidden edges.

- Analyze trailing 30-day outcomes to build a correlation matrix between categories
- Example findings: "When 3PT_SHOOTER over misses, BIG_REBOUNDER over hits 72% of the time"
- Store top 20 strongest correlations in `bot_adaptation_state`
- Generation engine uses these to boost/penalize correlated legs in the same parlay
- Anti-correlation pairs get a synergy bonus; high-correlation pairs get a stacking penalty

### Module 5: Dynamic Tier Optimizer

Automatically restructure tier configs based on which leg counts and strategies are actually winning.

- Analyze last 30 days of settled parlays by `leg_count` and `tier`
- If 2-leg parlays are winning at 65% but 4-leg at 30%, shift execution toward 2-leg profiles
- Auto-generate new profiles for winning leg count + sport combinations
- Retire profiles that haven't produced a win in 14+ days
- Store recommended tier config in `bot_adaptation_state` for next generation cycle

### Module 6: Quality Gate Auto-Tuner

Dynamically adjust the minEdge, minHitRate, minSharpe, and minComposite thresholds.

- If execution tier win rate > 60%, slightly **lower** gates to increase volume (more bets at good accuracy)
- If execution tier win rate < 40%, **raise** gates to restrict to only the highest-quality picks
- Adjustments are small (5% per cycle) to prevent overcorrection
- Each threshold has a hard floor and ceiling to prevent runaway tuning
- Stores `gate_overrides` JSONB in `bot_adaptation_state`

### Module 7: Adaptation Writer

Atomically writes all changes and logs a complete adaptation report.

- Updates `bot_category_weights` with recency rates and Bayesian adjustments
- Updates `bot_adaptation_state` with regime, correlations, tier recommendations, gate overrides
- Logs a detailed adaptation report to `bot_activity_log` and sends a Telegram summary
- All changes are timestamped so the generation engine always reads the latest state

## Database Changes

### New Table: `bot_adaptation_state`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| adaptation_date | date | Date of this adaptation snapshot |
| current_regime | text | Detected market regime |
| regime_confidence | numeric | How confident the regime detection is (0-100) |
| regime_weights | jsonb | Per-category weight multipliers for this regime |
| correlation_matrix | jsonb | Top cross-category correlations |
| tier_recommendations | jsonb | Recommended tier config overrides |
| gate_overrides | jsonb | Quality gate threshold overrides |
| adaptation_score | numeric | Overall system health score (0-100) |
| modules_run | jsonb | Which modules ran and their individual results |
| created_at | timestamptz | Timestamp |

### Modify: `bot_category_weights`

Add 3 new columns:
- `recency_hit_rate` (numeric) -- Exponential-decay-weighted hit rate
- `bayesian_hit_rate` (numeric) -- Bayesian-adjusted hit rate
- `regime_multiplier` (numeric, default 1.0) -- Current regime-specific multiplier

## Integration Points

### Generation Engine (`bot-generate-daily-parlays`)

Before building the candidate pool, read the latest `bot_adaptation_state`:
1. Apply `regime_multiplier` to each category's weight
2. Use `bayesian_hit_rate` (instead of raw `current_hit_rate`) for all hit rate gates
3. Apply correlation bonuses/penalties when scoring multi-leg parlays
4. Use `gate_overrides` to dynamically set minEdge, minHitRate, etc.
5. Use `tier_recommendations` to select which profiles to run

### Pipeline Orchestrator

Add `bot-adaptive-intelligence` as the first step of Phase 5 (Calibration & Learning), running before `calibrate-bot-weights` and `recalibrate-sharp-signals`.

## Files Changed

1. **NEW** `supabase/functions/bot-adaptive-intelligence/index.ts` -- The unified adaptive engine (all 7 modules)
2. **MODIFY** `supabase/functions/bot-generate-daily-parlays/index.ts` -- Read adaptation state and apply regime weights, Bayesian rates, correlation bonuses, gate overrides
3. **MODIFY** `supabase/functions/data-pipeline-orchestrator/index.ts` -- Add `bot-adaptive-intelligence` to Phase 5
4. **DATABASE** -- Create `bot_adaptation_state` table, add 3 columns to `bot_category_weights`

## What This Means for You

- Every single cycle, the AI evaluates its own accuracy across 7 dimensions and adjusts
- Recent results matter more than stale data (recency decay)
- Small samples don't trick the system into overconfidence (Bayesian calibration)
- Market conditions are detected and responded to automatically (regime detection)
- Hidden edges between categories are exploited (correlation mapping)
- The system restructures its own bet sizing and tier allocation (tier optimizer)
- Quality gates self-tune to find the sweet spot between volume and accuracy (gate tuner)
- Everything is logged, traceable, and visible in the bot dashboard

