

# Build Custom Pick Scoring Model from Historical Hit/Miss Data

## What You Want

Yesterday: 25/49 picks hit (51%). Instead of using generic scoring (L10 hit rate + composite), build a **data-driven Pick Score** trained on what actually makes YOUR picks win — using every settled pick in `category_sweet_spots`.

## The Insight

You have 20+ data columns per pick that are available at pick time. Some of these correlate strongly with hits, others don't. Right now the system scores picks using just L10 hit rate + a crude historical prop rate bonus. A proper model would weight ALL available signals based on which ones actually predicted wins.

## Signals Available for Scoring

From `category_sweet_spots`, each pick has these pre-game signals:
- `l10_hit_rate` — last 10 game hit rate
- `l10_avg`, `l5_avg`, `l3_avg` — recent averages (trend direction)
- `l10_std_dev` — consistency (low = reliable)
- `l10_median`, `l10_min`, `l10_max` — distribution shape
- `confidence_score` — current composite confidence
- `season_avg` — full season baseline
- `line_difference` — gap between recommended and actual line
- `matchup_adjustment` — opponent strength factor
- `pace_adjustment` — game speed factor
- `h2h_avg_vs_opponent`, `h2h_matchup_boost` — head-to-head history
- `bounce_back_score` — post-bad-game rebound tendency
- `buffer_pct` (calculated) — L10 avg vs line cushion
- `prop_type + side` — category-level historical win rate

## Plan

### 1. Create `analyze-pick-dna` Edge Function

Queries ALL settled picks from `category_sweet_spots` (outcome = hit/miss), calculates correlation between each signal and outcome, then derives optimal weights:

```
For each signal (l10_hit_rate, l10_std_dev, buffer, etc.):
  avg_when_hit = AVG(signal) WHERE outcome = 'hit'
  avg_when_miss = AVG(signal) WHERE outcome = 'miss'
  separation = (avg_when_hit - avg_when_miss) / stddev(signal)
  weight = normalized separation score
```

Stores the derived weights in a new `pick_score_weights` table.

### 2. Create `pick_score_weights` Table

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | PK |
| signal_name | text | e.g. "l10_hit_rate", "buffer_pct" |
| weight | numeric | Learned importance (-1 to +1) |
| avg_when_hit | numeric | Average value for winning picks |
| avg_when_miss | numeric | Average value for losing picks |
| separation | numeric | How well this signal separates wins/losses |
| sample_size | integer | How many settled picks were analyzed |
| calibrated_at | timestamp | When weights were last computed |

### 3. Create `calculate-pick-score` Utility in Straight Bet Generator

Replace the current crude scoring with:

```
pick_score = SUM(signal_value × learned_weight) for each signal
```

Normalized to 0-100 scale. Picks with `pick_score < 50` get skipped. Picks with `pick_score > 80` get priority.

### 4. Wire Into `bot-generate-straight-bets`

- Before ranking candidates, load weights from `pick_score_weights`
- For each candidate, compute `pick_score` using the learned weights
- Replace `composite_score` sorting with `pick_score` sorting
- Include `pick_score` in Telegram output

### 5. Wire Into Nightly Pipeline

Add `analyze-pick-dna` to Phase 4 (after settlement), so weights recalibrate daily as new outcomes arrive. This creates a self-improving feedback loop.

### 6. Telegram Report: "Pick DNA Report"

After recalibration, send a Telegram summary:
```
🧬 PICK DNA — March 22
📊 2,847 settled picks analyzed

Top Win Signals:
1. Buffer % (0.83 separation) — Winners avg +42%, losers avg +18%
2. L10 Std Dev (0.71) — Winners avg 1.8, losers avg 3.4
3. L3/L10 Trend (0.65) — Winners trending UP
4. Matchup Adj (0.52) — Winners had favorable matchups

Weak Signals (don't matter):
- Season Avg (0.08) — Nearly identical for wins/losses
- Confidence Score (0.12) — Current formula is noisy
```

## Expected Impact

- Current: picks scored by L10 hit rate + crude prop category bonus → 51% hit rate
- After: picks scored by 10+ weighted signals trained on actual outcomes → target 65%+ hit rate
- The model improves daily as more outcomes settle

## Files

1. **DB migration** — Create `pick_score_weights` table
2. **New: `supabase/functions/analyze-pick-dna/index.ts`** — Analyze settled picks, compute signal weights, store results, send Telegram report
3. **Edit: `supabase/functions/bot-generate-straight-bets/index.ts`** — Load learned weights, compute `pick_score` per candidate, replace sorting
4. **Edit: `supabase/functions/data-pipeline-orchestrator/index.ts`** — Add `analyze-pick-dna` to Phase 4

