

## Daily Ladder Challenge Bot

### Concept
Inspired by the Brandon Miller 6-threes game: find ONE player per day most likely to massively exceed their prop line, then create a "ladder" of bets at increasing lines (e.g., Over 1.5 at -200, Over 2.5 at -110, Over 3.5 at +130). When the player goes off, every rung of the ladder hits.

### Intelligence Criteria (Pick Selection)
The scanner will rank players using a weighted composite of:
1. **L10 Average vs Line** (25%) -- How far above the lowest line is their recent average?
2. **L10 Floor (Minimum)** (15%) -- Worst-case scenario protection; higher floor = safer ladder
3. **Opponent 3PT Defense Rank** (20%) -- `opp_threes_rank` from `team_defense_rankings`; targeting rank 20-30 (weak perimeter D)
4. **Offensive Pace** (10%) -- Fast-paced games create more possessions and shot opportunities
5. **L10 Hit Rate at Middle Rung** (15%) -- How often they'd clear the 2nd ladder line in last 10
6. **Ceiling Games** (15%) -- Count of L10 games where they hit 4+ threes (explosion potential)

### Ladder Structure (3 Rungs)
For the selected player, the function builds 3 legs saved as a single `bot_daily_parlays` entry:
- **Rung 1 (Safety)**: Lowest available line (e.g., Over 1.5) -- high probability anchor
- **Rung 2 (Value)**: Middle line (e.g., Over 2.5) -- the sweet spot
- **Rung 3 (Boom)**: Highest line (e.g., Over 3.5) -- the upside swing

Each rung is a separate leg with its own odds, but they're grouped as a ladder strategy.

### New Edge Function
**File**: `supabase/functions/nba-ladder-challenge/index.ts`

The function will:
1. Fetch today's available player props from The Odds API (3-pointers only initially)
2. Group all lines for each player (1.5, 2.5, 3.5, 4.5, etc.)
3. Cross-reference with `category_sweet_spots` for L10 stats (avg, median, min, hit rate)
4. Fetch `team_defense_rankings` for opponent `opp_threes_rank`
5. Score each player using the weighted composite above
6. Select the top-1 player and build the 3-rung ladder
7. Save to `bot_daily_parlays` with `strategy_name: 'ladder_challenge'`, `tier: 'execution'`
8. Send a Telegram notification with the ladder pick details

### Telegram Output Format
```text
-- LADDER CHALLENGE --
Brandon Miller | 3PT OVER
vs Trail Blazers (Rank 28 3PT Defense)

Rung 1: Over 1.5 (-180) -- L10: 10/10
Rung 2: Over 2.5 (-110) -- L10: 8/10
Rung 3: Over 3.5 (+130) -- L10: 6/10

L10 Avg: 3.8 | Floor: 2 | Ceiling: 6
Matchup: ELITE (weak perimeter D + fast pace)
```

### Technical Details

**Data sources used:**
- The Odds API (live sportsbook lines for all available 3PT lines per player)
- `category_sweet_spots` (L10 avg, median, min, hit rate, confidence)
- `nba_player_game_logs` (individual game values for ceiling/floor analysis)
- `team_defense_rankings` (opp_threes_rank for matchup grading)

**Key logic:**
- Only considers players with 3+ different lines available from sportsbooks (ensures ladder depth)
- Requires L10 avg >= middle rung line (safety check)
- Requires opponent `opp_threes_rank` >= 15 (no ladders against elite 3PT defense)
- Deduplication: checks existing `ladder_challenge` entries for today to avoid duplicates

**Config in `supabase/config.toml`:**
```toml
[functions.nba-ladder-challenge]
verify_jwt = false
```

**Files to create:**
- `supabase/functions/nba-ladder-challenge/index.ts`

**No database schema changes needed** -- uses existing `bot_daily_parlays` table with `strategy_name = 'ladder_challenge'`.
