

## Customer `/lookup` Command for Telegram Bot

### What You'll Get
A new `/lookup` command available to **all authorized customers** (not just admin) that lets them type a player name and get an instant cross-reference report pulling from your existing data:

**Example usage:**
```
/lookup LeBron James
```

**Example response:**
```
🔍 PLAYER LOOKUP — LeBron James
━━━━━━━━━━━━━━━━━━━━━

📊 L10 Game Log:
  Mar 1: 28 PTS | 8 REB | 7 AST | 2 3PT
  Feb 28: 31 PTS | 6 REB | 9 AST | 3 3PT
  ... (10 games)

📈 L10 Averages:
  PTS: 27.3 | REB: 7.1 | AST: 8.2 | 3PT: 2.4

🛡️ Tonight's Matchup vs BOS:
  Opp Def Overall: #4 (Elite)
  vs PTS: #3 ⚠️ | vs 3PT: #7 ⚠️
  vs REB: #22 🔥 | vs AST: #15

📋 Today's Props (if available):
  PTS O25.5 (-110) | L10 hit: 8/10
  REB O6.5 (-115) | L10 hit: 6/10
  AST O7.5 (-120) | L10 hit: 7/10
```

### How It Works (Data Sources -- All Existing)

1. **L10 Game Logs** — `nba_player_game_logs` table (points, rebounds, assists, threes, steals, blocks, minutes)
2. **Defense Rankings** — `team_defense_rankings` table (opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank)
3. **Today's Props** — `unified_props` table (current lines, over/under prices)
4. **Opponent Identification** — Game description from `unified_props` or `game_bets` to find tonight's opponent
5. **Player-to-Team Mapping** — Derived from game logs (most recent opponent field) or game_description in unified_props

No new scrapers needed -- all data already exists in the pipeline.

### Technical Changes

#### 1. `telegram-webhook/index.ts` — Add `/lookup` command handler

Add a new `handleLookup(chatId, playerName)` function that:

- **Fuzzy-matches** the player name using `ilike` on `nba_player_game_logs` (last name match)
- **Pulls L10 game logs** sorted by game_date descending, limit 10
- **Calculates L10 averages** for PTS, REB, AST, 3PT, STL, BLK
- **Finds today's opponent** by checking `unified_props` for this player's name today, extracting opponent from `game_description`
- **Fetches defense rankings** for the opponent from `team_defense_rankings` where `is_current = true`
- **Pulls today's prop lines** from `unified_props` for this player
- **Calculates hit rates** — for each prop line, counts how many of L10 games would have gone over/under
- **Formats** into a compact Telegram message

Wire it into the customer command router (line ~3387) and admin command router (line ~3229) so both can use it.

Update `/help` for customers to include `/lookup [player]`.

#### 2. Team Abbreviation Resolution

Reuse the NBA team name-to-abbreviation mapping (already exists in `bot-matchup-defense-scanner`) inline in the webhook to resolve opponent names from game descriptions to abbreviations for defense ranking lookups.

### Files Modified
- `supabase/functions/telegram-webhook/index.ts` — add `handleLookup()` function + wire into both admin and customer command routers + update help text

### No New Tables or Scrapers Needed
Everything pulls from existing data that's already being populated by the pipeline.

