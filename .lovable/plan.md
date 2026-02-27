

## Matchup-Aware Alt Line UPGRADE System (Offensive Boost)

### Problem
Kon Knueppel went over by 8 -- meaning the bot left value on the table. When the matchup data clearly shows a player is facing a weak defense and their L10 average is well above the line, the bot should shop for a HIGHER alt line to get better odds (plus money) while still winning comfortably.

### What Already Exists
The Defensive Downgrade system (just implemented) only moves lines DOWN for safety when facing tough defense. It needs a mirror: an **Offensive Upgrade** that moves lines UP for better odds when facing weak defense with a large projection buffer.

### Solution: Add "Offensive Upgrade" Logic

Expand the existing `shouldDowngradeLine()` function into a bidirectional `shouldAdjustLine()` function that can recommend lines in BOTH directions:

**Triggers for UPGRADE (OVER picks):**
- Opponent defense rank >= 20 for the specific stat (bottom-10 defense = soft matchup)
- Player's defense-adjusted average is MORE than 2x the step size above the line (large buffer)
- Player's L10 average is MORE than 3x the step size above the line
- Example: Knueppel L10 avg ~18, line at 10.5, opponent defense rank 25 -> upgrade to 12.5 or 14.5

**Triggers for UPGRADE (UNDER picks):**
- Opponent defense rank <= 10 (elite defense suppresses stats)
- Player's average is well below the line with large margin

**Step sizes remain the same:** threes/blocks/steals = 0.5, points/rebounds/assists = 1.0, combos = 1.5

**Safety cap:** Maximum upgrade of 2 steps (e.g., points can go up by 2.0 max, threes by 1.0 max) to avoid overreaching.

### Changes Required

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

#### 1. Rename and expand `shouldDowngradeLine()` to `shouldAdjustLine()`
- Add new return field: `direction: 'downgrade' | 'upgrade' | 'none'`
- Keep all existing downgrade logic unchanged
- Add new UPGRADE logic block after the downgrade checks:
  - For OVER picks facing weak defense (rank >= 20) with large buffer (defAdjAvg - line > 2x step): recommend line + stepSize (capped at line + 2*stepSize)
  - For UNDER picks facing elite defense (rank <= 10) with large buffer: recommend line - stepSize
  - GOD MODE uses rank >= 18 (more aggressive upgrade threshold)

#### 2. Update `findAvailableAltLine()` to handle upgrades
- Already works bidirectionally (the fallback search in step 3 filters by direction)
- Just need to ensure the "closest alts" search also works for higher lines when upgrading

#### 3. Update integration point (around line 6190-6220)
- Change `shouldDowngradeLine` call to `shouldAdjustLine`
- Handle both `downgrade` and `upgrade` directions
- Log upgrades: `[LineUpgrade] Knueppel points 10.5 -> 12.5 (OPP def rank 25, adj avg 18.2)`

#### 4. Update leg metadata
- Rename `was_downgraded` to `was_line_adjusted` (or keep and add `was_upgraded`)
- Add `line_adjustment_direction: 'downgrade' | 'upgrade' | null`
- Keep `original_line_before_downgrade` (works for both directions)

### Example: How This Would Have Improved the Knueppel Pick

```text
Pick: Kon Knueppel Over 10.5 Points
Opponent defense rank (points): ~25 (bottom-10)
L10 average: ~18
Defense-adjusted average: ~18.5

shouldAdjustLine() triggers UPGRADE:
  - Defense rank 25 >= 20 (weak defense)
  - Buffer: 18.5 - 10.5 = 8.0 > 2.0 (2x step)
  - Recommended: 10.5 + 1.0 = 11.5 (or even 12.5)

findAvailableAltLine():
  - Checks Hard Rock for "Knueppel points Over 12.5"
  - Found at +120 odds (plus money!)
  - Returns { line: 12.5, odds: +120 }

Result: Bot picks Over 12.5 at +120 instead of Over 10.5 at -130
Knueppel gets 18 -> Both hit, but +120 adds more parlay value
```

### No Database Changes Needed
All changes are within the existing edge function. The metadata fields already exist on leg data from the downgrade implementation.

### Technical Summary
- Modify ~30 lines in `shouldDowngradeLine()` to add upgrade path
- Update ~5 lines in the integration block to handle both directions  
- Update ~3 lines in leg metadata for upgrade tracking
- Total: ~40 lines changed in one file
