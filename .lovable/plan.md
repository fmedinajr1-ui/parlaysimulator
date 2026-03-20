

# Fix Straight Bets & Parlays: Use Real FanDuel Lines + Buffer Gate

## Problem

The straight bet generator (`bot-generate-straight-bets`) uses `recommended_line` from `category_sweet_spots` — a **calculated** line, not the actual FanDuel sportsbook line. This means:

1. Picks show lines that don't exist on FanDuel (can't actually bet them)
2. No buffer check — if L10 avg is 5.1 and real line is 5.5, that's a terrible OVER pick even at 100% L10 hit rate on the old line
3. The parlay generator already does FanDuel line lookup from `unified_props` but straight bets skip this entirely

The `category_sweet_spots` table has an `actual_line` column (populated by the analyzer from real odds), but the straight bet generator ignores it.

## Solution

### 1. Use real FanDuel lines for straight bets

In `bot-generate-straight-bets/index.ts`, after gathering candidates from sweet spots:

- Cross-reference each candidate against `unified_props` (FanDuel bookmaker) to get the **real current sportsbook line**
- If a FanDuel line exists, use it instead of `recommended_line`
- If no FanDuel line exists, fall back to `actual_line` from sweet spots, then `recommended_line` as last resort
- Tag each pick with `line_source: 'fanduel' | 'actual_line' | 'recommended'` for transparency

### 2. Add buffer gate — skip picks with thin margins

After resolving the real line, calculate the buffer:
```
buffer = (l10_avg - real_line) / real_line  // for OVER
buffer = (real_line - l10_avg) / real_line  // for UNDER
```

- **Require buffer ≥ 15%** — if a player averages 5.1 and the line is 5.0, that's only 2% buffer = SKIP
- This matches the March 12 winning pattern where all winners had 49%+ cushion above line

### 3. Apply same fix to parlay generator's sweet spot line resolution

The parlay generator (`bot-generate-daily-parlays`) already queries FanDuel props but some strategies still fall back to `recommended_line` when the odds map misses. Add the same buffer gate: any leg where L10 avg vs real line buffer < 10% gets skipped or deprioritized.

### 4. Show real line + buffer in Telegram output

Update the Telegram message format to include the actual FanDuel line and buffer percentage:
```
⬆️ RJ Barrett OVER 14.5 PTS (FD line)
   L10: 100% | Avg: 24.1 | Buffer: +66% | $25
```

## Files Changed

1. **`supabase/functions/bot-generate-straight-bets/index.ts`**
   - Add FanDuel line lookup from `unified_props` for each candidate
   - Add buffer calculation and 15% minimum gate
   - Use real line in bet record and Telegram message
   - Tag `line_source` on each pick

2. **`supabase/functions/bot-generate-daily-parlays/index.ts`**
   - Add buffer check in leg assembly loop — skip legs where L10 avg vs real line < 10%

## Expected Impact

- Every straight bet will have a real, bettable FanDuel line
- Thin-margin picks (the ones that usually lose) get automatically filtered
- Telegram shows you exactly what to bet and the safety margin

