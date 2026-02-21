

## Cross-Reference MLB Mispriced Lines

### Current State
- MLB mispriced line detection **already exists** in `detect-mispriced-lines` (pulls from `unified_props` for `baseball_mlb` and compares against 44K+ historical game logs)
- Two additional MLB analyzers (`mlb-batter-analyzer`, `mlb-pitcher-k-analyzer`) also write to `mispriced_lines`
- The `high-conviction-analyzer` already cross-references `mispriced_lines` (sport-agnostic) against engine picks
- **Problem**: The engines it checks (`nba_risk_engine_picks`, `prop_engine_v2_picks`, sharp/heat parlays) are NBA-only. MLB mispriced lines have **nothing to cross-reference against**, so they never appear as high-conviction plays

### What Needs to Happen

**Create an MLB cross-reference engine** that validates MLB mispriced lines using MLB-specific signals, similar to how NBA uses the risk engine and prop engine.

#### Data Sources Available for MLB Cross-Reference
1. **`mlb_player_game_logs`** (44,541 logs) -- L10/L20/season trends, hit rates, consistency metrics
2. **`pp_snapshot`** (PrizePicks lines) -- batter_home_runs, pitcher_strikeouts, player_1st_inning_runs_allowed, player_hitter_fantasy_score
3. **`mlb-batter-analyzer` output** -- already computes L10/L20 averages, hit rates, edge percentages
4. **`mlb-pitcher-k-analyzer` output** -- same for pitcher strikeouts

#### Implementation: New Edge Function `mlb-prop-cross-reference`

This function will act as an MLB-specific engine that produces picks stored in a new `mlb_engine_picks` table, which the `high-conviction-analyzer` can then cross-reference.

**Step 1 -- Create `mlb_engine_picks` table**
```
- player_name (text)
- prop_type (text) 
- line (numeric)
- side (text: OVER/UNDER)
- confidence_score (numeric)
- signal_sources (jsonb) -- which signals contributed
- game_date (date)
- created_at (timestamptz)
- unique constraint on (player_name, prop_type, game_date)
```

**Step 2 -- New edge function: `mlb-prop-cross-reference`**

This function generates MLB engine picks by combining multiple validation signals:

1. **Trend Signal**: Compare L10 avg vs L20/season avg. If a player is trending significantly above their season baseline, that confirms an OVER mispriced signal (and vice versa)
2. **Hit Rate Signal**: Calculate how often the player has gone over/under the current line in their last 10-20 games. A 70%+ hit rate strongly confirms the direction
3. **Consistency Signal**: Low standard deviation + strong edge = higher confidence (the player consistently performs at this level)
4. **PrizePicks Line Comparison**: If PrizePicks sets a line and the odds API has a different line, the discrepancy itself is a signal
5. **Pitcher K Analyzer Cross-Check**: For pitcher strikeouts, check if the `mlb-pitcher-k-analyzer` independently found the same signal

Confidence score formula:
- Base: edge_pct weight (0-40 points)
- Hit rate bonus: (hit_rate - 50) * 0.5 (0-25 points)  
- Trend alignment bonus: if L10 trend matches signal direction (+15 points)
- Consistency bonus: low std dev relative to mean (+10 points)
- Multi-source bonus: if both batter-analyzer and detect-mispriced found same signal (+10 points)

**Step 3 -- Update `high-conviction-analyzer`**

Add a 6th parallel query to fetch from `mlb_engine_picks`:
```typescript
supabase.from('mlb_engine_picks')
  .select('player_name, prop_type, line, side, confidence_score')
  .eq('game_date', today)
```

Add picks to the engine map with `engine: 'mlb_cross_ref'`.

**Step 4 -- Update `useHighConvictionPlays` hook**

Same change -- add the `mlb_engine_picks` query to the parallel fetch and feed results into the engine map.

**Step 5 -- Wire into pipeline**

Add `mlb-prop-cross-reference` to the `data-pipeline-orchestrator` Phase 2, after `mlb-batter-analyzer` and `mlb-pitcher-k-analyzer` but before `high-conviction-analyzer`.

### Technical Details

**New files:**
- `supabase/functions/mlb-prop-cross-reference/index.ts`

**Modified files:**
- `supabase/functions/high-conviction-analyzer/index.ts` -- add `mlb_engine_picks` query
- `src/hooks/useHighConvictionPlays.ts` -- add `mlb_engine_picks` query  
- `supabase/functions/data-pipeline-orchestrator/index.ts` -- add to Phase 2

**New database table:**
- `mlb_engine_picks` with RLS disabled (backend-only writes via service role)

### Note on Timing
MLB regular season starts late March. Currently only 4 spring training prop types exist in PrizePicks. The infrastructure will be ready and will start producing cross-referenced picks as soon as MLB props appear in `unified_props` (from the odds scraper) and game logs accumulate.

