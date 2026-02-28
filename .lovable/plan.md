
# Fix Parlay Quality: Edge Inflation, Low-Line Domination, and Missing Lottery Picks

## Root Cause Analysis

Looking at today's mispriced lines data, the top 15 entries are ALL **0.5-line binary props** (blocks, steals, threes) with artificially massive edges:
- Sengun blocks 0.5 → 240% edge (avg 1.7)
- Josh Green threes 0.5 → 191% edge (avg 1.4)
- Brandon Miller steals 0.5 → 170% edge (avg 1.3)

Meanwhile, real actionable value props like **Grant Williams 6.5 points (50% edge)** or **Coby White 17.5 PRA (47% edge)** are buried. The percentage formula `(avg - line) / line * 100` inherently inflates low-line props: averaging 1.7 vs a 0.5 line = 240%, but averaging 25 vs 17.5 = 43%.

This cascades into every downstream generator: force-fresh, lottery scanner, and sharp builder all pull from `mispriced_lines` and are dominated by 0.5-line "will they record at least 1" props.

---

## 5 Fixes Across 3 Files

### Fix 1: Cap Edge Inflation in Mispriced Detector
**File:** `supabase/functions/detect-mispriced-lines/index.ts`

Cap `edge_pct` at 75% maximum (positive or negative). This prevents 0.5-line props from producing 240% edges that drown out everything else. A 75% cap means Sengun's blocks (240% raw) would be stored as 75%, putting it on more equal footing with Grant Williams' points (50%).

- After calculating `edgePct` (around line 327): `edgePct = Math.max(-75, Math.min(75, edgePct))`
- Same cap for MLB edge calculation (around line 467)

### Fix 2: Raise MIN_LINES for Blocks and Steals
**File:** `supabase/functions/detect-mispriced-lines/index.ts`
**File:** `supabase/functions/bot-force-fresh-parlays/index.ts`

Raise minimum line thresholds to eliminate binary "at least 1" props:
- `player_blocks`: 0.5 --> 1.5
- `player_steals`: 0.5 --> 1.5

These 0.5-line props are essentially coin flips, not real value plays. A 1.5 line means the player needs 2+ blocks/steals, which is a real commitment and aligns with standard sportsbook offerings.

Apply in both:
- `detect-mispriced-lines` NBA MIN_LINES (line ~296-303)
- `bot-force-fresh-parlays` MIN_LINES (line ~145-152)

### Fix 3: Force-Fresh Quality Gate
**File:** `supabase/functions/bot-force-fresh-parlays/index.ts`

Two changes:
1. **Add minimum book_line filter to query** (line ~115): Add `.gte('book_line', 1.5)` to the mispriced_lines query so 0.5-line props never enter the force-fresh pipeline
2. **Remove Math.abs from conviction scoring** (line 180): Change `Math.abs(ml.edge_pct)` to just `ml.edge_pct`. Since we're only fetching ELITE/HIGH with positive edges (after the cap fix), this correctly weights by actual edge magnitude rather than treating negative edges as strong positives

### Fix 4: Lottery Scanner Hit Rate Fallback
**File:** `supabase/functions/nba-mega-parlay-scanner/index.ts`

The lottery scanner requires `hitRate >= 60` from sweet spots, but most Odds API players don't match sweet spot data, so `hitRate = 0` and they're all filtered out. This is why zero lottery parlays were saved.

Add a game-log-based hit rate calculation as fallback (around line 344):
```
if hitRate is 0 and game logs exist for this player+prop:
  count how many of L10 games the stat exceeded the prop line (for OVER)
  or fell below it (for UNDER)
  hitRate = (games_hit / total_games) * 100
```

This uses the same game logs we already fetched and gives the lottery scanner real data to work with.

### Fix 5: Lottery Scanner MIN_LINES Sync
**File:** `supabase/functions/nba-mega-parlay-scanner/index.ts`

The Odds API filtering doesn't apply MIN_LINES. Add a filter after scoring (before parlay building, around line 536) to reject any props with `line < 1.5` for blocks/steals, matching the mispriced detector. This prevents binary props from entering the lottery parlay even if they come from the Odds API directly.

---

## Expected Impact

- Today's mispriced lines will have edges capped at 75%, putting points/assists/rebounds/PRA props on equal footing with blocks/steals
- Force-fresh parlays will feature real value plays (Grant Williams points, Coby White PRA, Miles Bridges assists) instead of 0.5-line binary props
- Lottery scanner will actually generate and save parlays using game-log hit rates when sweet spots don't match
- All three generators will exclude "at least 1 block/steal" props via raised MIN_LINES

## Files Modified

1. `supabase/functions/detect-mispriced-lines/index.ts` -- Edge cap at 75%, raise blocks/steals MIN_LINES to 1.5
2. `supabase/functions/bot-force-fresh-parlays/index.ts` -- Add book_line >= 1.5 filter, remove Math.abs, raise MIN_LINES
3. `supabase/functions/nba-mega-parlay-scanner/index.ts` -- Add hit rate fallback from game logs, add MIN_LINES filter for blocks/steals
