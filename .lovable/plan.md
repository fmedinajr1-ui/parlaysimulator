

## Fix MLBST Props Pipeline: Scraping, Cross-Reference, and Edge Detection

### Root Cause Analysis

The pipeline has 3 breakpoints preventing MLBST props from working:

1. **PP Scraper crashes (CPU timeout)** before reaching MLB data. It tries to process ALL PrizePicks leagues (COD esports, CBB, MMA, etc.) and hits the Deno edge function CPU limit. Unknown leagues like "COD" and "CBB" fall through to `basketball_nba` as a default, adding noise and wasting time.

2. **MLB props never reach `unified_props`**. The PP scraper only writes to `pp_snapshot`. The `whale-odds-scraper` (which feeds `unified_props`) hasn't fetched baseball odds. Without `unified_props` data, the War Room and Sweet Spots dashboards can't display MLB props.

3. **MLB analyzers never run**. The `mlb-batter-analyzer`, `mlb-prop-cross-reference`, and `detect-mispriced-lines` (for MLB) all depend on `pp_snapshot` having fresh MLB data AND being triggered. The orchestrator calls them, but they find no data to work with because of issue #1.

### Fix Plan

**Step 1: Fix PP Scraper efficiency and mapping**

File: `supabase/functions/pp-props-scraper/index.ts`

- Add missing leagues to `LEAGUE_TO_SPORT` map (CBB, COD, MMA, etc.) so they don't fall through to `basketball_nba`
- Add an early filter to skip unsupported leagues BEFORE the expensive logging/processing loop
- This prevents CPU timeout by reducing the number of projections processed
- Add `batter_hits`, `batter_rbis`, `batter_runs`, `batter_stolen_bases` stat type mappings for MLB-specific stat names from PrizePicks (e.g., "Hits" for MLB should map to `batter_hits`, not `player_hits`)

**Step 2: Bridge MLB props from `pp_snapshot` to `unified_props`**

File: `supabase/functions/mlb-prop-cross-reference/index.ts`

- After generating engine picks, also upsert MLB props from `pp_snapshot` into `unified_props` so the War Room and Sweet Spots dashboards can display them
- Map `pp_snapshot` fields to `unified_props` columns (player_name, prop_type, current_line, sport, game_description from matchup, etc.)
- This fills the gap since `whale-odds-scraper` doesn't always fetch MLB odds

**Step 3: Add dedicated MLB prop sync function**

File: `supabase/functions/mlb-props-sync/index.ts` (new)

- A lightweight function that reads today's MLB props from `pp_snapshot` and syncs them into `unified_props`
- Fetches corresponding odds from `whale-odds-scraper` data if available, otherwise uses PrizePicks lines as the baseline
- Runs as part of the orchestrator pipeline before the analyzers

**Step 4: Wire into orchestrator**

File: `supabase/functions/data-pipeline-orchestrator/index.ts`

- Add `mlb-props-sync` call before `detect-mispriced-lines` and `mlb-prop-cross-reference`
- Ensure `mlb-batter-analyzer` is also called in the pipeline (currently missing from orchestrator)

### Technical Details

**PP Scraper fix -- league mapping additions:**
```typescript
const LEAGUE_TO_SPORT: Record<string, string> = {
  // ... existing mappings ...
  'CBB': 'basketball_ncaab',
  'COD': 'esports_cod',
  'MMA': 'mma_ufc',
  'SOCCER': 'soccer',
  'CSGO': 'esports_csgo',
  'LOL': 'esports_lol',
  'DOTA2': 'esports_dota2',
  'VAL': 'esports_val',
};
```

**PP Scraper fix -- MLB-specific stat mapping:**
```typescript
// In processExtractedProjections, after league detection:
if (league === 'MLB' || league === 'MLBST') {
  // Override generic mappings for baseball
  if (proj.stat_type === 'Hits') normalizedStat = 'batter_hits';
  if (proj.stat_type === 'RBIs') normalizedStat = 'batter_rbis';
  if (proj.stat_type === 'Runs') normalizedStat = 'batter_runs';
  if (proj.stat_type === 'Stolen Bases') normalizedStat = 'batter_stolen_bases';
}
```

**MLB Props Sync function -- core logic:**
```text
1. Read today's MLB props from pp_snapshot (sport = 'baseball_mlb')
2. For each prop, build a unified_props row:
   - event_id from pp_snapshot.event_id
   - sport = 'baseball_mlb'
   - game_description from matchup or constructed from team data
   - player_name, prop_type (stat_type), current_line (pp_line)
   - bookmaker = 'prizepicks'
3. Upsert into unified_props with conflict on (event_id, player_name, prop_type, bookmaker)
4. Trigger mlb-batter-analyzer and mlb-prop-cross-reference
```

**Orchestrator update:**
```text
Phase 2 (Analysis):
  1. detect-mispriced-lines (existing)
  2. mlb-props-sync (NEW - bridges pp_snapshot to unified_props)  
  3. mlb-batter-analyzer (existing - now gets data)
  4. mlb-prop-cross-reference (existing - now gets data)
  5. high-conviction-analyzer (existing)
```

### Files Modified
- `supabase/functions/pp-props-scraper/index.ts` -- Fix league mapping, add MLB stat overrides, prevent CPU timeout
- `supabase/functions/mlb-props-sync/index.ts` -- New function to bridge pp_snapshot to unified_props for MLB
- `supabase/functions/data-pipeline-orchestrator/index.ts` -- Add mlb-props-sync and mlb-batter-analyzer to pipeline
- `supabase/functions/mlb-prop-cross-reference/index.ts` -- Minor: also sync results to unified_props

### Expected Outcome
After these changes:
- PP scraper runs without CPU timeout
- MLB/MLBST props appear in `pp_snapshot` with correct stat types
- MLB props flow into `unified_props` for dashboard visibility
- `mlb-batter-analyzer` cross-references props against `mlb_player_game_logs` (44k+ logs available)
- `mlb-prop-cross-reference` generates picks into `mlb_engine_picks`
- War Room and Sweet Spots dashboards can display MLB prop cards

