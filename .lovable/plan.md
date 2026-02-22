

## Dynamic Winning Archetype Detection

### What Changes

Instead of hardcoding `THREE_POINT_SHOOTER`, `VOLUME_SCORER`, `BIG_REBOUNDER`, `HIGH_ASSIST` as the winning categories, the bot will **query the last 14 days of settled parlays** at the start of every run and automatically detect which category+side combos are winning the most.

### How It Works

```text
EVERY DAY AT GENERATION TIME:
1. Query bot_daily_parlays (last 14 days, outcome = won/lost)
2. Group by category + side, calculate parlay win rate
3. Rank categories by win rate (minimum 5 appearances)
4. Top categories (win rate > 25% AND at least 8 appearances) become the new "winning archetypes"
5. Inject these into WINNING_ARCHETYPE_CATEGORIES and all archetype profile preferCategories
```

### Current vs Dynamic

**Today (static):**
```
WINNING_ARCHETYPE_CATEGORIES = ['THREE_POINT_SHOOTER', 'VOLUME_SCORER', 'BIG_REBOUNDER', 'HIGH_ASSIST']
-- Never changes, even if these categories start losing
```

**After (dynamic):**
```
Day 1: Data says VOLUME_SCORER (34.7%), BIG_REBOUNDER (34.3%), ASSISTS (100%) are hot
  -> WINNING_ARCHETYPE_CATEGORIES = ['VOLUME_SCORER', 'BIG_REBOUNDER', 'ASSISTS']
  -> All archetype profiles target these

Day 14: Data shifts, SHARP_SPREAD now winning at 40%, VOLUME_SCORER drops to 15%
  -> WINNING_ARCHETYPE_CATEGORIES = ['SHARP_SPREAD', 'BIG_REBOUNDER', ...]
  -> Bot auto-adapts without code changes
```

### Technical Details

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

**1. Add `detectWinningArchetypes()` function (~40 lines)**

A new async function that:
- Queries `bot_daily_parlays` for the last 14 days (settled only)
- Extracts each leg's `category` and `side` from the JSONB `legs` column
- Groups by category+side, calculates parlay-level win rate
- Returns the top categories meeting thresholds:
  - Minimum 8 parlay appearances (statistical significance)
  - Win rate above 25% (above average for a 3-leg parlay)
  - Cap at 6 categories max (prevents dilution)
- Falls back to the current hardcoded list if no data or query fails

**2. Call it in the main handler (after adaptive intelligence loads, ~line 6264)**

Insert a call to `detectWinningArchetypes(supabase)` right before the pool building phase. Store the result in a variable `dynamicArchetypes`.

**3. Replace the hardcoded `WINNING_ARCHETYPE_CATEGORIES` (line 4556)**

Change from:
```typescript
const WINNING_ARCHETYPE_CATEGORIES = new Set(['THREE_POINT_SHOOTER', 'VOLUME_SCORER', 'BIG_REBOUNDER', 'HIGH_ASSIST']);
```
To:
```typescript
const WINNING_ARCHETYPE_CATEGORIES = dynamicArchetypes;
```

The `dynamicArchetypes` variable (a `Set<string>`) will be passed through the tier generation loop and used in the sorting logic.

**4. Update archetype profile `preferCategories` dynamically**

Before each tier runs, update the `preferCategories` on all `winning_archetype_*` profiles to use the top categories from the dynamic detection instead of the hardcoded ones. Split them into two groups:
- `winning_archetype_3pt_scorer` profiles get the top 2 categories
- `winning_archetype_reb_ast` profiles get categories 3-4

**5. Log the detection results**

Add a console log showing what the bot detected:
```
[Bot v2] Dynamic Archetypes: VOLUME_SCORER (34.7%, 75 apps), BIG_REBOUNDER (34.3%, 35 apps), MID_SCORER_UNDER (26.7%, 15 apps) | Fallback: false
```

### Safety Rails

- **Minimum sample size**: Categories need 8+ parlay appearances to qualify (prevents flukes)
- **Fallback**: If the query fails or returns no qualifying categories, falls back to the current hardcoded list
- **Cap at 6**: Even if 10 categories qualify, only the top 6 by win rate are used (prevents bonus dilution)
- **No code deploys needed**: The bot automatically adapts every day based on what's actually winning

### Expected Behavior

Using today's actual data, the dynamic detector would select:
1. VOLUME_SCORER (34.7% win rate, 75 appearances)
2. BIG_REBOUNDER (34.3%, 35 appearances)
3. LOW_LINE_REBOUNDER (28.6%, 14 appearances)
4. OVER_TOTAL (28.6%, 21 appearances)
5. MID_SCORER_UNDER (26.7%, 15 appearances)
6. SHARP_SPREAD (26.2%, 42 appearances)

Notice: THREE_POINT_SHOOTER (25.0%) and HIGH_ASSIST (21.1%) would actually drop off since they're below the 25% threshold -- the static config was giving them undeserved priority. The bot will now correctly focus on what's actually winning.

