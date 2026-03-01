

## Void Duplicates and Generate 3 Distinct Lottery Parlays

### Problem
The lottery scanner is deterministic -- each run picks the same top-scoring candidates, producing identical tickets. We need to void 2 duplicates and add an exclusion mechanism so consecutive runs produce unique parlays.

### Step 1: Void 2 Duplicate Lottery Tickets
Use the database insert tool to mark 2 of the 3 duplicate pending lottery tickets (March 1) as `void` with a note explaining the reason, keeping only the oldest one active.

### Step 2: Add Deduplication to the Lottery Scanner
Modify `supabase/functions/nba-mega-parlay-scanner/index.ts` to:
- Accept an optional `exclude_players` array in the request body
- Before building the parlay, filter out any props from players in the exclusion list
- Also add automatic dedup: at the start, query today's existing `mega_lottery_scanner` parlays from `bot_daily_parlays` and extract all player names already used, merging them into the exclusion set
- This ensures each consecutive run naturally avoids repeating the same players

The key change is in the `passesBasicChecks` function and pre-build filtering:
```text
// Parse exclude_players from request body
const { exclude_players = [] } = body;

// Query existing lottery parlays for today and extract used players
const existingLotteryParlays = await supabase
  .from('bot_daily_parlays')
  .select('legs')
  .eq('parlay_date', today)
  .eq('strategy_name', 'mega_lottery_scanner')
  .neq('outcome', 'void');

// Merge into a single exclusion set
const excludeSet = new Set([
  ...exclude_players.map(normalizeName),
  ...extractedPlayerNames.map(normalizeName)
]);

// Add to passesBasicChecks:
if (excludeSet.has(normalizeName(prop.player_name))) return false;
```

### Step 3: Regenerate 2 Fresh Lottery Tickets
After deploying the updated scanner, invoke it twice. Each run will automatically exclude players from already-saved tickets, producing 3 distinct parlays with different player combinations and proper prop diversity (`MAX_SAME_PROP = 2`).

### Technical Details
- **File modified**: `supabase/functions/nba-mega-parlay-scanner/index.ts`
- **Database operations**: UPDATE 2 rows in `bot_daily_parlays` to `outcome = 'void'`
- **No schema changes needed**
- The auto-dedup is additive to the existing `MAX_SAME_PROP` and `MAX_PER_GAME` constraints

