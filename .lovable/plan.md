# Matchup Scanner Accuracy Tracking

## ✅ IMPLEMENTED

### Step 1: Edge Function Created
- **File**: `supabase/functions/generate-matchup-scanner-picks/index.ts`
- Mirrors client-side zone analysis logic
- Saves `strong` and `moderate` confidence picks to `category_sweet_spots`
- Categories: `MATCHUP_SCANNER_PTS` and `MATCHUP_SCANNER_3PT`
- Fetches actual lines from `unified_props`

### Step 2: Verification (Automatic)
- Uses existing `verify-sweet-spot-outcomes` function
- No changes needed - picks auto-settle via game logs

### Step 3: RPC Updated
- Fixed `verified_at` → `settled_at` bug for Lock Mode
- Added `matchup_scanner_pts` section (📊 icon)
- Added `matchup_scanner_3pt` section (🎯 icon)
- Excluded matchup scanner from Sweet Spots aggregation

---

## Next Steps

1. **Run daily**: Add cron trigger for `generate-matchup-scanner-picks`
2. **Monitor**: Check accuracy after 7 days of data collection
3. **Tune**: Adjust `determineSide()` thresholds if accuracy < 55%

