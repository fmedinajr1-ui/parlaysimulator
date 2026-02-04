
# Fix: Pre-Game Matchup Scanner UTC Date Alignment

## Problem Identified

The `usePreGameMatchupScanner` hook filters games using local browser time boundaries:
```typescript
const startOfDay = new Date(today);
startOfDay.setHours(0, 0, 0, 0);  // Local midnight
const endOfDay = new Date(today);
endOfDay.setHours(23, 59, 59, 999);  // Local 11:59 PM
```

But games are stored in UTC. Tonight's 7:10 PM ET game is stored as `2026-02-05 00:10:00+00`, which falls **outside** the local day range.

## Data Verification

| Game | UTC Time | ET Time |
|------|----------|---------|
| Denver @ New York | 2026-02-05 00:10 | Feb 4, 7:10 PM |
| Minnesota @ Toronto | 2026-02-05 00:40 | Feb 4, 7:40 PM |
| Boston @ Houston | 2026-02-05 01:10 | Feb 4, 8:10 PM |
| New Orleans @ Milwaukee | 2026-02-05 01:10 | Feb 4, 8:10 PM |
| OKC @ San Antonio | 2026-02-05 02:40 | Feb 4, 9:40 PM |
| Memphis @ Sacramento | 2026-02-05 03:10 | Feb 4, 10:10 PM |
| Cleveland @ LA Clippers | 2026-02-05 03:40 | Feb 4, 10:40 PM |

**Total: 7 games, 555 props loaded**

## Solution

Apply the same UTC offset pattern from `useTodayProps`:

```text
Eastern Date: 2026-02-04
UTC Start: 2026-02-04 12:00:00 UTC (covers early afternoon ET games)
UTC End:   2026-02-05 12:00:00 UTC (covers late night ET games into 7 AM next day)
```

This 24-hour window from noon-to-noon UTC correctly captures all games on an Eastern Time "day."

## Technical Changes

### File: `src/hooks/usePreGameMatchupScanner.ts`

**Lines 143-154** - Replace local time calculation with ET-aware UTC range:

```typescript
// Calculate the UTC range for today's Eastern Time games
// Games stored in UTC need offset: ET date maps to UTC noon-to-noon
const todayETDate = getEasternDate(); // e.g., "2026-02-04"
const [year, month, day] = todayETDate.split('-').map(Number);

// Start: Today at 12:00 UTC (covers morning ET games)
const startUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
// End: Tomorrow at 12:00 UTC (covers late-night ET games)
const endUTC = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));

const { data, error } = await supabase
  .from('unified_props')
  .select('player_name, game_description, commence_time, event_id')
  .gte('commence_time', startUTC.toISOString())
  .lt('commence_time', endUTC.toISOString())
  .eq('sport', 'basketball_nba')
  .eq('is_active', true)
  .is('outcome', null);
```

## Expected Result

After fix:
- **7 games** displayed in the Matchup Scanner
- **~50-80 players** with matchup analysis (depends on zone data coverage)
- Grade distribution calculated across all tonight's players
- Props will correctly show 7:10 PM, 7:40 PM, etc. tip-off times

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/usePreGameMatchupScanner.ts` | Replace lines 143-154 with ET-aware UTC range calculation |
