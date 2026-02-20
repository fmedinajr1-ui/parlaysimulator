

## Fix MLB Pitcher Data Extraction + Run Backfill

### Root Cause

The `extractStats` function in `mlb-data-ingestion` has been processing 24K+ batting rows but zero pitching rows. The pitching detection logic checks for labels `IP`, `ER`, `ERA` in the `statGroup.labels` array, but this check is likely failing because:

1. ESPN's pitching `statGroup` may use a `name` or `type` field (e.g., `"name": "pitching"`) that we're ignoring
2. The label format may differ from expectations (e.g., case sensitivity after uppercasing, different abbreviation)
3. If both batting and pitching labels contain `H` (hits/hits allowed), the `isBatting` check fires first and the `else if (isPitching)` branch never runs for pitching groups that also happen to match batting criteria

### Fix Plan

**File: `supabase/functions/mlb-data-ingestion/index.ts`**

1. **Use `statGroup.name` or `statGroup.type` for detection** instead of label-sniffing:
   - Check `statGroup.name?.toLowerCase() === 'pitching'` or `statGroup.type === 'pitching'` as the primary detection method
   - Keep label-based detection as a fallback
   - This ensures pitching groups are never misidentified as batting

2. **Fix the `isBatting` / `isPitching` mutual exclusion**:
   - Currently `isPitching` is in an `else if` — if `isBatting` triggers first (because labels contain `H` which appears in both), pitching entries are skipped
   - Change to check `statGroup.name` first, then fall back to labels

3. **Add debug logging** (temporary):
   - Log the `statGroup` name/type and labels for each group processed
   - Log the count of pitching entries found per game
   - This lets us verify the fix works before running the full backfill

4. **Smaller batch support**:
   - Add a `max_days_per_run` parameter (default 3) to prevent timeouts
   - Each weekly backfill chunk processes 3 days at a time

### Updated `extractStats` Logic

```typescript
for (const statGroup of (teamStats.statistics || [])) {
  const groupName = (statGroup.name || statGroup.type || '').toLowerCase();
  const labels = (statGroup.labels || statGroup.keys || []).map((l: string) => l.toUpperCase());
  
  // Use group name as primary detection, labels as fallback
  const isBatting = groupName === 'batting' || 
    (!groupName && (labels.includes('AB') && labels.includes('RBI')));
  const isPitching = groupName === 'pitching' || 
    (!groupName && (labels.includes('IP') && labels.includes('ER')));
  
  // ... rest of logic with isBatting/isPitching as separate if blocks, not if/else if
}
```

### Execution After Deploy

1. Deploy the fixed function
2. Test with a single recent game day to verify pitcher data appears: `{ "pitchers_only": true, "days_back": 3 }`
3. Check logs to confirm pitching groups are detected
4. Run weekly backfill chunks (April-October 2025) in 3-day increments:
   - `{ "pitchers_only": true, "start_date": "2025-04-01", "end_date": "2025-04-03" }`
   - Continue in 3-day chunks across the season

### Files Changed

| Action | File |
|--------|------|
| Modify | `supabase/functions/mlb-data-ingestion/index.ts` |

