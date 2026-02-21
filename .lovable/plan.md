
## Fix Hitter Fantasy Score + Wire MLB into Parlay Bot + Pull Props

### 4 Changes in One Shot

**1. Fix `mlb-batter-analyzer` -- Add `player_hitter_fantasy_score`**

File: `supabase/functions/mlb-batter-analyzer/index.ts`

- Add `player_hitter_fantasy_score: null` to `STAT_MAP` (line 26, after `player_fantasy_score`)
- Add `player_hitter_fantasy_score: 'Hitter Fantasy Score'` to `PROP_LABELS` (line 42)
- Update `isFantasy` check on line 140 to: `prop.stat_type === 'player_fantasy_score' || prop.stat_type === 'player_hitter_fantasy_score'`

This unlocks 117 hitter fantasy score props for mispriced line detection.

---

**2. Fix `mlb-prop-cross-reference` -- Add Fantasy Score calculation**

File: `supabase/functions/mlb-prop-cross-reference/index.ts`

- Add `'player_hitter_fantasy_score': '__fantasy__'` and `'player_fantasy_score': '__fantasy__'` to `PROP_TO_STAT` map
- Add `walks` to the game log select query (needed for fantasy calc)
- When `statCol === '__fantasy__'`, use custom calculation per game: `hits + walks + runs + rbis + total_bases + stolen_bases`
- Replace `avg()` and `stdDev()` calls with custom value arrays for fantasy props

---

**3. Wire MLB Engine Picks into Parlay Bot**

File: `supabase/functions/bot-generate-daily-parlays/index.ts`

- After line 3021 (mispriced lines fetch), add a parallel fetch for `mlb_engine_picks` where `game_date = targetDate`
- Build an `mlbEngineMap` keyed by `playerName|propType`
- In the mispriced enrichment loop (around line 4155), when a pick matches an `mlb_engine_picks` entry with matching side:
  - Add composite score boost: `+((confidence_score - 40) * 0.5)` (yields +5 to +17.5 points)
  - Flag as `mlb_cross_confirmed: true` for tracking
- Add MLB-specific parlay profiles:
  - Exploration: `{ legs: 3, strategy: 'mispriced_edge', sports: ['baseball_mlb'] }` (x2)
  - Validation: `{ legs: 3, strategy: 'mispriced_edge', sports: ['baseball_mlb'], minHitRate: 55 }`
  - Execution: `{ legs: 3, strategy: 'mispriced_edge', sports: ['baseball_mlb'], minHitRate: 55, sortBy: 'composite' }`

---

**4. Trigger Parlay Bot after MLB Analysis**

File: `supabase/functions/data-pipeline-orchestrator/index.ts`

- After `mlb-prop-cross-reference` (line 130), add: `await runFunction('bot-generate-daily-parlays', { source: 'mlb_pipeline' });`
- This ensures fresh MLB picks immediately flow into parlay generation without waiting for Phase 3

---

**5. After Deploy: Pull Props**

Once deployed, invoke the MLB pipeline sequence:
1. `mlb-batter-analyzer` -- now processes hitter fantasy score props
2. `mlb-prop-cross-reference` -- cross-references ALL MLB props including fantasy
3. Verify results in `mispriced_lines` and `mlb_engine_picks`

---

### Files Modified

1. `supabase/functions/mlb-batter-analyzer/index.ts` -- Add `player_hitter_fantasy_score` to STAT_MAP, PROP_LABELS, isFantasy check
2. `supabase/functions/mlb-prop-cross-reference/index.ts` -- Add `__fantasy__` sentinel handling with calculated field
3. `supabase/functions/bot-generate-daily-parlays/index.ts` -- Fetch `mlb_engine_picks`, boost cross-confirmed MLB picks, add MLB parlay profiles
4. `supabase/functions/data-pipeline-orchestrator/index.ts` -- Trigger parlay bot after MLB analysis

### Expected Outcome

- 117 hitter fantasy score props get analyzed and cross-referenced
- All MLB engine picks (K's, HR's, fantasy, etc.) boost mispriced line scoring in parlay bot
- Dedicated MLB parlay profiles generate baseball-specific parlays
- Pipeline auto-triggers parlay generation after MLB cross-reference completes
- Props pulled and verified immediately after deploy
