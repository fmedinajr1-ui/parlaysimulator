

## Plan: Fix Telegram Display, Sport Tagging, Cross-Sport 4-Leg, and Add Trap Detection

### Three Issues Identified

**Issue 1: "Take Player UNDER 19.5" — Missing prop type labels in Telegram**
The `formatLegDisplay` function in `bot-send-telegram/index.ts` and `telegram-webhook/index.ts` has a `propLabels` map that's missing NHL/MLB prop types: `player_assists`, `player_points`, `player_goals`, `player_steals`, `player_threes`, `player_double_double`, `pitcher_strikeouts`, `total_bases`, `hits`, `runs`, `hitter_fantasy_score`.

The display shows `🏀 Take Player UNDER 19.5` with no prop label because prop_type `player_assists` → `('' || '').toUpperCase()` → empty string. Also the sport icon is hardcoded to 🏀 for all player props.

**Fix**: Expand the `propLabels` map in both files to include all `player_*` variants and add sport-specific icons (🏒 for NHL, ⚾ for MLB).

**Issue 2: NHL players tagged as `basketball_nba`**
Line 4653 in `bot-generate-daily-parlays/index.ts`: `sport: pick.sport || 'basketball_nba'`. Since `category_sweet_spots` has no `sport` column, ALL picks default to `basketball_nba`. This prevents cross-sport 4-leg parlays from being assembled (the generator can't distinguish sports).

**Fix**: Derive sport from the category name prefix:
- `NHL_*` → `icehockey_nhl`
- `NCAAB_*` → `basketball_ncaab`  
- `MLB_*` / `PITCHER_*` / `HITTER_*` → `baseball_mlb`
- Default → `basketball_nba`

Apply this derivation at line 4653 and everywhere else `pick.sport || 'basketball_nba'` is used for sweet spots.

**Issue 3: No trap detection on parlay legs**
The `trap-probability-engine` exists but is never called during parlay generation. The user wants a trap signal flag on each parlay leg, similar to yesterday's output.

**Fix**: After assembling parlay legs, add a lightweight trap check in the Telegram `/parlays` formatter that cross-references each leg against `trap_probability_analysis` (if cached) and appends a ⚠️ TRAP or ✅ SAFE indicator. This avoids slowing down generation while surfacing trap intel at display time.

### Files to Change

1. **`supabase/functions/bot-generate-daily-parlays/index.ts`**
   - Add `deriveSportFromCategory(category)` helper function
   - Replace all `pick.sport || 'basketball_nba'` for sweet spots with `deriveSportFromCategory(pick.category)`
   - This unblocks cross-sport 4-leg generation by correctly tagging NHL/MLB picks

2. **`supabase/functions/bot-send-telegram/index.ts`**
   - Expand `propLabels` map with all `player_*` variants
   - Add sport-specific icons (🏒, ⚾, 🎾) instead of hardcoded 🏀

3. **`supabase/functions/telegram-webhook/index.ts`**
   - Expand `propLabels` in `formatLegDisplay` with all `player_*` variants
   - Add sport-specific emoji logic
   - Add trap detection display: after formatting each leg, check `trap_probability_analysis` cache and append risk indicator (⚠️/✅)

