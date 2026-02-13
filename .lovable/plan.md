

# Fix NHL Sport Key in whale-odds-scraper + Verify Pipeline

## Problem

Two issues preventing NHL picks from appearing:

1. **No NHL games today** -- The Odds API returned 0 events for `icehockey_nhl`. This is likely an off-day or All-Star break. No action needed here; games will appear when the schedule resumes.

2. **Sport key normalization bug** -- Line 100 of `whale-odds-scraper/index.ts` converts `icehockey_nhl` to `hockey_nhl` when storing odds:
   ```
   if (sportKey === 'icehockey_nhl') return 'hockey_nhl';
   ```
   This means when NHL games DO exist, the stored `game_bets` will have `sport = 'hockey_nhl'`, but the whale-signal-detector and scoring engine now expect `icehockey_nhl`. The data will never match.

## Fix

### `supabase/functions/whale-odds-scraper/index.ts`

Remove the `icehockey_nhl` → `hockey_nhl` conversion from `normalizeSportKey()` (line 100). Keep `icehockey_nhl` as-is so it matches the signal detector, scoring engine, and UI tab.

**Before:**
```typescript
function normalizeSportKey(sportKey: string): string {
  if (sportKey.startsWith('tennis_atp')) return 'tennis_atp';
  if (sportKey.startsWith('tennis_wta')) return 'tennis_wta';
  if (sportKey === 'icehockey_nhl') return 'hockey_nhl';
  return sportKey;
}
```

**After:**
```typescript
function normalizeSportKey(sportKey: string): string {
  if (sportKey.startsWith('tennis_atp')) return 'tennis_atp';
  if (sportKey.startsWith('tennis_wta')) return 'tennis_wta';
  return sportKey;
}
```

### Verification

After deploying, the next time the pipeline runs with NHL games on the schedule:
1. `whale-odds-scraper` stores `game_bets` with `sport = 'icehockey_nhl'`
2. `whale-signal-detector` finds them and adds sharp scores
3. `team-bets-scoring-engine` scores them with shot differential, save %, win %, home ice
4. NHL tab on Team Bets page displays the scored picks

No other files need changes -- this is the last piece of the sport key alignment.

