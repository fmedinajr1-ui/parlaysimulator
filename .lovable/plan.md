

## Table Tennis Over Total Points Model

### Overview
Build a dedicated table tennis scoring engine focused exclusively on **Over total points**, using the statistical formulas you provided (Tier 1 weighted expected total + Tier 2 normal approximation for P(Over)).

### Current State
- The scraper (`whale-odds-scraper`) already includes `tennis_pingpong` in Tier 2 sports and fetches totals/h2h/spreads markets
- However, The Odds API currently returns 0 events for `tennis_pingpong` (seasonal/regional availability)
- All table tennis games route through the generic tennis scoring engine, which checks game totals around 21-23 (wrong -- TT match totals are ~75-90 points)
- The AI research agent already collects `table_tennis_signals` but they only feed sharp/fatigue boosts, not the statistical model

### Implementation

**1. New Database Table: `tt_match_stats`**

Stores historical match statistics per player to power the formulas:

| Column | Type | Purpose |
|--------|------|---------|
| `player_name` | text | Player identifier |
| `avg_match_total` (AMT) | numeric | Average total points per match (last N) |
| `avg_period_total` (APT) | numeric | Average points per set |
| `pct_3_sets` (p3) | numeric | % of matches ending in 3 sets |
| `pct_4_sets` (p4) | numeric | % ending in 4 sets |
| `pct_5_sets` (p5) | numeric | % ending in 5 sets |
| `recent_over_rate` (RO) | numeric | Recent over rate (e.g., 13/15 = 0.867) |
| `std_dev_total` | numeric | Historical standard deviation of match totals |
| `sample_size` | integer | Number of matches in sample |
| `last_updated` | timestamp | Freshness tracking |

**2. New Edge Function: `tt-stats-collector`**

Uses Perplexity AI (already integrated via the research agent pattern) to collect player stats before each day's generation:
- Query recent match results for players in upcoming `tennis_pingpong` events
- Parse AMT, APT, set distribution percentages, and recent over rates
- Upsert into `tt_match_stats`
- Called by the data pipeline orchestrator before parlay generation

**3. Dedicated Table Tennis Scoring Engine**

Replace the generic tennis scorer for `tennis_pingpong` totals with the formula-based engine in `bot-generate-daily-parlays`:

```text
Step A: Expected Total
  E[T] = 0.45 * AMT_player1 + 0.45 * AMT_player2 + 0.10 * (APT1 + APT2) * S_hat

Step B: Expected Sets
  S_hat = 3*p3 + 4*p4 + 5*p5

Step C: Recent Over Adjustment
  Adj = 0.25 * (RO - 0.50) * sigma
  E[T]_final = E[T] + Adj

Step D: P(Over) via Normal Approximation (Tier 2)
  sigma^2 = sigma_set^2 * S_hat + Var(S) * APT_avg^2
  P(Over L) = 1 - Phi((L - E[T]_final) / sigma)

Decision:
  P(Over) >= 0.60 --> lean Over (composite score boost)
  P(Over) >= 0.65 --> strong Over (higher boost)
  P(Over) < 0.45 --> block (skip this pick)
```

**4. Wire Into Parlay Generation**

- In `calculateTeamCompositeScore`, add a new route for `tennis_pingpong` that calls `calculateTableTennisOverScore()`
- The new function:
  - Looks up both players in `tt_match_stats`
  - Computes E[T], P(Over) using the formulas above
  - Returns a composite score scaled from the probability (e.g., P(Over) 0.60 = score 70, P(Over) 0.70 = score 85)
  - **Only scores Over picks** -- Under picks get score 0 (blocked)
- Fallback: if no stats exist for a player, use the current odds-implied scoring as a safety net (with a penalty for low confidence)

**5. Over-Only Filter for Table Tennis Profiles**

Update the strategy profiles to enforce Over-only:
- `table_tennis_focus` profiles: add `side: 'over'` and `betTypes: ['total']`
- `validated_tennis` profiles that include `tennis_pingpong`: filter to only include TT Over totals
- Block all TT moneyline/spread/under picks from entering parlays

**6. Research Agent Enhancement**

Update the `table_tennis_signals` research query to also ask for:
- Recent match totals for players in upcoming events
- Average points per set and set distributions
- Recent over/under track records against specific lines
This data feeds into `tt-stats-collector` for more accurate stat population.

### Technical Details

**Files Changed:**

| File | Change |
|------|--------|
| Database migration | Create `tt_match_stats` table with RLS |
| `supabase/functions/tt-stats-collector/index.ts` | New edge function: collect TT player stats via Perplexity |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `calculateTableTennisOverScore()` engine; route `tennis_pingpong` to it; update profiles to Over-only |
| `supabase/functions/ai-research-agent/index.ts` | Enhance `table_tennis_signals` query to include stats for the model |
| `supabase/functions/data-pipeline-orchestrator/index.ts` | Add `tt-stats-collector` call before parlay generation phase |

**Key Formula Constants (tunable after backtesting):**
- `k = 0.25` (recent over adjustment dampener)
- `sigma_default = 8` (fallback std dev when no history)
- `sigma_set = 3` (per-set std dev)
- P(Over) threshold: 0.60 to play, 0.65 for strong
- E[T] - Line margin: >= 2.0 to lean, >= 4.0 to play (secondary check)

**Data Availability Note:**
The Odds API may not always list `tennis_pingpong` events (currently 0). When events appear (ITTF/WTT tours, major leagues), the scraper will automatically pick them up and the model will score them. In the meantime, the stats collector can pre-populate player profiles so the model is ready when events go live.
