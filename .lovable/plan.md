

## Fix: Increase Parlay Volume and Remove Single Picks

### Problem 1: Fingerprint Saturation

The generator runs ~12 times daily. After the first run creates parlays from a 49-pick pool, all subsequent runs pre-load those fingerprints and fail to find new unique combinations. This is the **primary reason** today only produced 13 parlays vs 50 yesterday.

**Fix**: Reset the deduplication scope so each generation run can create parlays independently, while still preventing exact duplicates within a single run.

Specifically in `bot-generate-daily-parlays/index.ts`:
- Change the pre-loaded fingerprint logic (lines 6342-6374) to only block **exact duplicates** (same players, same props, same sides), not near-matches
- Add a "generation batch" concept: each cron run gets its own batch ID, and fingerprints only block within the same batch
- Increase the `maxPlayerUsage` for exploration tier from 2 to 4, and `maxCategoryUsage` from 6 to 10 -- the small pool (49 picks) gets exhausted too quickly with tight usage caps

### Problem 2: Single Picks Still Being Created

The single-pick code path is explicitly built into the exploration tier generator. It creates 1-leg entries for high-composite picks.

**Fix**: Remove the single-pick generation block entirely (lines ~6830-6912). These provide no parlay value and inflate the count misleadingly. If standalone pick tracking is needed, it should go to a separate `bot_single_picks` table, not `bot_daily_parlays`.

### Problem 3: Pool Too Small for 50 Parlays

With only 49 player picks and 14 team picks, the math doesn't support 50+ unique 3-leg parlays without some overlap. Yesterday's 52 parlays included 8 from `force_mispriced_conviction` (which voids and regenerates) and more diverse strategy coverage.

**Fix**: 
- Allow the same player to appear in up to 3 different parlays (currently capped at 2 for exploration)
- Allow 2 players from the same team across different parlays (currently 1)
- On days with fewer than 30 player picks, automatically trigger a relaxed "volume mode" that:
  - Lowers the minimum hit rate from 45% to 40%
  - Allows prop type reuse across parlays (e.g., two different parlays can both have a "points" leg)
  - Increases unique matchup cap from 2 to 4

### Technical Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **Batch-scoped deduplication** (lines 6342-6374): Only load existing fingerprints for blocking exact duplicates, not for usage tracking. Reset `globalGameUsage`, `globalMatchupUsage`, and `globalTeamUsage` maps per generation batch instead of accumulating across all runs.

2. **Remove single-pick generation** (lines ~6830-6912): Delete the entire block that creates 1-leg entries. This removes the `single_pick_accuracy` and `single_pick_value` strategies from output.

3. **Volume mode for small pools** (near line 6264): When `playerPropCount < 30`, activate a `volumeMode` flag that:
   - Sets `exploration.maxPlayerUsage = 4`
   - Sets `exploration.maxTeamUsage = 5`
   - Sets `exploration.maxCategoryUsage = 10`
   - Lowers `exploration.minHitRate` from 45 to 40

4. **Loosen per-run usage tracking**: The `createUsageTracker` currently enforces strict per-parlay limits. In volume mode, relax these so the combinator can find more valid combinations from the same pick pool.

### Expected Impact

- With relaxed dedup and usage caps, each cron run should generate 8-15 parlays instead of 0-2
- Across 12 daily runs, this should produce 40-60 parlays consistently
- No single picks cluttering the parlay table
- Quality is maintained because composite score, hit rate, and defense adjustment filters still apply -- only the diversity/uniqueness constraints are relaxed

### No Database Changes Required

All changes are within the edge function logic. No new columns or tables needed.
