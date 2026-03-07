

## Plan: Fix Ladder Challenge to Use Most Accurate Pick of the Day

### Problem
The current ladder challenge independently fetches odds API lines and scores them with its own safety system. It doesn't leverage the **sweet spot engine** data which already identifies the most accurate picks with precise L10 hit rates. This means it can miss the truly most accurate pick of the day.

### Solution
Flip the approach: **start from sweet spots (the accuracy engine), then match to live lines** — instead of starting from odds API lines and trying to match to sweet spots.

### Changes to `supabase/functions/nba-ladder-challenge/index.ts`

**New flow:**

1. **Keep** dedup check and fresh data refresh (unchanged)
2. **NEW Step 1**: Query `category_sweet_spots` for today's date, sorted by `l10_hit_rate` descending — these ARE the most accurate picks
3. **NEW Step 2**: Query `nba_player_game_logs` for L10 data on top candidates to verify floor/median gates
4. **Step 3**: Fetch live lines from Odds API only for the top sweet spot players (targeted, not blanket scan)
5. **Step 4**: Apply safety gates (90% hit rate, floor > line, median +1) using sweet spot L10 data + game logs
6. **Step 5**: Score with existing safety formula but **prioritize hit rate even more** — the sweet spot with highest L10 hit rate that passes all gates wins
7. **Keep** persistence, Telegram broadcast, and settlement logic unchanged

**Key differences from current:**
- Sweet spots are the **source of truth** for accuracy — not a secondary lookup
- Only fetches odds API lines for players already identified as most accurate
- Reduces API calls (fewer odds fetches) while improving pick quality
- Falls back to current odds-first approach if no sweet spots qualify

### No database changes needed. Only the edge function logic changes.

