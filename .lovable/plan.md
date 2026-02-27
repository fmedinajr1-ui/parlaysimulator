
## Matchup-Aware Alt Line Shopping (Defensive Downgrade System)

### Problem
Andrew Wiggins Over 2.5 Threes missed by 1 (got 2). The other 2 legs hit. The bot had the matchup data showing a tough defensive matchup but still picked the standard 2.5 line instead of shopping for the safer Over 2.0 alt line on Hard Rock.

### Root Cause
The current `selectOptimalLine()` function only moves lines **UP** (higher line for better odds/plus money). It never considers moving lines **DOWN** for safety when matchup data signals the player will underperform. Additionally, this function is gated behind `useAltLines: true` profiles and aggressive strategy names -- so GOD MODE and execution tier profiles (which use `useAltLines: false`) never even attempt alt line shopping.

### Solution: "Defensive Downgrade" Alt Line System

#### 1. Add `shouldDowngradeLine()` Function
A new function that checks if a pick's matchup context warrants dropping to a lower (safer) line:

**Triggers for downgrade (OVER picks):**
- Opponent defense rank <= 10 for the specific stat category (top-10 defense)
- Player's defense-adjusted average is within 0.5 of the line (tight margin)
- Player's L10 average is within 1.0 of the line

**Triggers for downgrade (UNDER picks):**
- Opponent defense rank >= 20 (weak defense = players score more)
- Same tight-margin checks but inverted

The function returns a recommended alt line (e.g., line - 0.5 for threes/blocks/steals, line - 1.0 for points/rebounds/assists).

#### 2. Add `fetchAltLinesFromBooks()` Function
Before applying a downgrade, the bot checks if the alt line actually exists on Hard Rock (or other books):
- Query `unified_props` for the same player + prop type to find all available lines
- If the alt line exists, use it (with the corresponding odds)
- If it doesn't exist, keep the original line but flag it as "tight margin - no alt available"
- This prevents the bot from recommending phantom lines that can't be bet

#### 3. Integrate Into Pick Selection (All Tiers)
Unlike the current `useAltLines` system (which is opt-in per profile), the defensive downgrade runs on ALL execution and GOD MODE picks automatically:
- After a pick is selected but before it's added to the parlay legs
- Check `shouldDowngradeLine()` using the existing `defenseDetailMap` and environment score data
- If triggered, look up available alt lines and swap if found
- Log the downgrade: `[DefDowngrade] Wiggins threes 2.5 -> 2.0 (OPP defense rank 4, adj avg 2.3)`

#### 4. Store Downgrade Metadata on Parlay Legs
Add fields to the leg data so you can track performance:
- `was_downgraded: boolean`
- `original_line_before_downgrade: number`  
- `downgrade_reason: string` (e.g., "top_10_defense_tight_margin")

This lets the settlement engine measure whether downgrades are improving hit rates.

### Technical Details

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **New function `shouldDowngradeLine()`** (near `passesGodModeMatchup`):
   - Inputs: pick data, defenseDetailMap, prop type
   - Uses stat-specific defense ranks (opp_threes_rank, opp_points_rank, etc.)
   - Returns `{ shouldDowngrade: boolean, recommendedLine: number, reason: string }`
   - Stat-aware step sizes: threes/blocks/steals drop by 0.5, points/rebounds/assists drop by 1.0, combos drop by 1.5

2. **New function `findAvailableAltLine()`**:
   - Queries the already-loaded `oddsMap` and `alternateLines` data for lower lines
   - Falls back to checking `unified_props` for the player to find all available lines from books
   - Returns the alt line + odds if found, or null

3. **Integration point** (around line 6035-6043 in the leg selection block):
   - After `selectedLine` is determined, run `shouldDowngradeLine()`
   - If downgrade triggered, call `findAvailableAltLine()` with the recommended lower line
   - If alt found, override `selectedLine` with the safer line
   - This runs for ALL profiles (not just `useAltLines: true`)

4. **Leg metadata** (around line 6045-6072):
   - Add `was_downgraded`, `original_line_before_downgrade`, `downgrade_reason` to legData

5. **GOD MODE profiles get mandatory downgrade checking**:
   - For `god_mode_lock` profiles, the downgrade threshold is more aggressive (opponent defense rank <= 15 instead of <= 10)

### Example: How This Would Have Saved the Wiggins Pick

```text
Pick: Andrew Wiggins Over 2.5 Threes
Opponent defense rank (3PT): ~4 (top-5)
L10 average: ~2.3
Defense-adjusted average: ~2.1

shouldDowngradeLine() triggers:
  - Defense rank 4 <= 10 (top-10 3PT defense)
  - Adjusted avg 2.1 within 0.5 of line 2.5
  - Recommended alt: 2.5 - 0.5 = 2.0

findAvailableAltLine():
  - Checks Hard Rock for "Wiggins threes Over 2.0"
  - Found at -180 odds
  - Returns { line: 2.0, odds: -180 }

Result: Bot picks Over 2.0 instead of Over 2.5
Wiggins gets 2 -> Over 2.0 HITS
Parlay wins instead of losing by 1 three
```

### No Database Changes Needed
All changes are within the existing edge function. The downgrade metadata fields are stored in the existing JSON leg structure of `bot_daily_parlays`.
