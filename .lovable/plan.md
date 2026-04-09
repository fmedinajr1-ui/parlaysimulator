

# Update 3 Edge Functions + Run Migration

## What's changing

Three edge functions get complete replacements with bug fixes, plus one migration for schema changes.

### Migration
- Add `engine_count`, `agreement_ratio`, `updated_at` columns to `high_conviction_results`
- Add unique constraint `(analysis_date, player_name, prop_type)` for upsert support (Bug 9)
- Add performance indexes on `high_conviction_results` and `fanduel_prediction_accuracy`

### 1. `detect-mispriced-lines/index.ts` (737 lines, full replace)
- **Bug 1**: Fix swapped MLB `player_avg_l10`/`player_avg_l20` fields
- **Bug 2**: Re-cap `alignedEdgePct` after all boosts/multipliers (was uncapped)
- **Bug 3**: Snapshot writes now run for both mispriced AND correct-priced results
- **Bug 5**: Feedback accuracy reads from `fanduel_prediction_accuracy` (settled data) instead of `mispriced_lines.outcome` (never written)

### 2. `high-conviction-analyzer/index.ts` (289 lines, full replace)
- **Bug 6**: Remove `bot_daily_parlays` as engine source (circular feedback loop)
- **Bug 7**: Side agreement uses 60% majority threshold instead of unanimous `.every()`
- **Bug 8**: Engine count bonus changed from additive to capped multiplier (1.0x–1.5x)
- **Bug 9**: Delete-then-insert replaced with atomic upsert + stale row cleanup

### 3. `bot-pipeline-doctor/index.ts` (527 lines, full replace)
- **Bug 10**: `stale_calibration` remediation now passes `force_run: true` to `calibrate-bot-weights`
- **Bug 11**: Remediation dedup uses exact `patternId` match instead of substring `.includes()`
- **Bug 12**: Profit correlation minimum lowered from 7 to 3 days; graceful fallback if table missing

## Files Changed
1. **Migration**: New columns + unique constraint + indexes on `high_conviction_results` and `fanduel_prediction_accuracy`
2. **Replace**: `supabase/functions/detect-mispriced-lines/index.ts`
3. **Replace**: `supabase/functions/high-conviction-analyzer/index.ts`
4. **Replace**: `supabase/functions/bot-pipeline-doctor/index.ts`

