

# Fix: NHL Scanner Name Mismatch (0 Results Bug)

## Root Cause
The scanner finds 571 active NHL props with **full names** (e.g., "Aaron Ekblad") from `unified_props`, but `nhl_player_game_logs` stores **abbreviated names** (e.g., "A. Ekblad") from ESPN. The `.in('player_name', batch)` query returns 0 matches, so no L10 stats are loaded and nothing gets analyzed.

Same issue for goalie logs ("Adin Hill" in some records, "A. Hill" in others).

## Fix

### Update `nhl-prop-sweet-spots-scanner/index.ts`

Add a name normalization layer:

1. **Build a reverse lookup map** from game logs: Query all distinct `player_name` values from `nhl_player_game_logs` and `nhl_goalie_game_logs`. Create a map keyed by last name (or "FirstInitial. LastName") pointing to the abbreviated form.

2. **Match prop names to log names**: For each prop player like "Aaron Ekblad", generate the abbreviated form "A. Ekblad" and look it up in the map. This handles 95%+ of cases.

3. **Query logs using mapped names**: Instead of querying with the full prop name, query with the matched abbreviated name, then map results back.

```typescript
// Convert "Aaron Ekblad" → "A. Ekblad"
function abbreviateName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}
```

4. **Handle edge cases**: Some goalie logs already have full names (mixed data from different fetch runs). Build the map to handle both forms.

### Files Changed
1. **`supabase/functions/nhl-prop-sweet-spots-scanner/index.ts`** — add name abbreviation + reverse lookup mapping so prop names match game log names

