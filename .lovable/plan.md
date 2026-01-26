

## Fix Lock Mode Backtest Schema Mismatch

### Problem

The `run-lock-mode-backtest` edge function queries `scout_prop_outcomes.game_date`, but the actual column is `analysis_date`. This causes the query to fail or return 0 results.

### Affected Lines

| Line | Current Code | Fix |
|------|--------------|-----|
| 293 | `.gte('game_date', dateStart)` | `.gte('analysis_date', dateStart)` |
| 294 | `.lte('game_date', dateEnd)` | `.lte('analysis_date', dateEnd)` |
| 296 | `.order('game_date', { ascending: true })` | `.order('analysis_date', { ascending: true })` |
| 317 | `const date = outcome.game_date` | `const date = outcome.analysis_date` |

### Implementation

Update `supabase/functions/run-lock-mode-backtest/index.ts`:

```typescript
// Line 290-296: Fix query to use analysis_date
const { data: outcomes, error: outcomesError } = await supabase
  .from('scout_prop_outcomes')
  .select('*')
  .gte('analysis_date', dateStart)   // Changed from game_date
  .lte('analysis_date', dateEnd)     // Changed from game_date
  .not('outcome', 'is', null)
  .order('analysis_date', { ascending: true });  // Changed from game_date

// Line 317: Fix date grouping
for (const outcome of outcomes || []) {
  const date = outcome.analysis_date;  // Changed from game_date
  if (!byDate.has(date)) {
    byDate.set(date, []);
  }
  byDate.get(date)!.push(outcome);
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/run-lock-mode-backtest/index.ts` | Replace 4 occurrences of `game_date` with `analysis_date` |

### Deployment

After the fix, the `run-lock-mode-backtest` function will be automatically deployed and will correctly query historical Scout outcomes for backtesting.

