

# `/rankings` + `/weekly` Rundown — Implementation Plan

## Two Features

### 1. `/rankings` Command (Team OFF/DEF Rankings)
Add a `handleRankings()` function with two modes:

**`/rankings`** — Summary view showing NBA + NHL teams sorted by overall rank:
- NBA: PTS, REB, 3PT, AST columns with OFF→DEF ranks
- NHL: Goals, Shots, PP, PK columns with FOR→AGT ranks

**`/rankings [team]`** — Single team profile (e.g., `/rankings BOS`):
- Checks both `team_defense_rankings` (NBA) and `nhl_team_defense_rankings` (NHL)
- Shows all category ranks in one card

Data sources:
- NBA `team_defense_rankings`: `off_points_rank`, `opp_points_rank`, `off_rebounds_rank`, `opp_rebounds_rank`, `off_threes_rank`, `opp_threes_rank`, `off_assists_rank`, `opp_assists_rank`
- NHL `nhl_team_defense_rankings`: `goals_for_rank`, `goals_against_rank`, `shots_for_rank`, `shots_against_rank`, `power_play_rank`, `penalty_kill_rank`

Available to both admin and customer users.

### 2. `/weekly` Command (Enhanced Weekly Rundown + Forward Leans)
Expand beyond the existing `/digest` (which is a simple W/L + P&L summary) to include:

**Past Week Recap:**
- Day-by-day record from `bot_activation_status`
- Strategy breakdown from `bot_daily_parlays`
- Hottest/coldest categories from `bot_category_weights`

**Forward Lean Recommendations:**
- Query `bot_category_weights` for top hit-rate categories (hot = lean into)
- Query `team_defense_rankings` for teams with worst defensive ranks per category (targets for overs)
- Cross-reference to produce "Lean Into" and "Fade" sections
- Available to both admin and customer users

### 3. Automated Sunday Broadcast
- Add a `pg_cron` job at `0 15 * * 0` (10:00 AM ET Sunday) calling the weekly rundown
- Broadcasts to all active users

## Files Changed
1. **`supabase/functions/telegram-webhook/index.ts`**:
   - Add `handleRankings(chatId, args)` function (~80 lines)
   - Add `handleWeeklyRundown(chatId)` function (~120 lines)
   - Register `/rankings` and `/weekly` in admin command routing (~line 3807)
   - Register `/rankings` and `/weekly` in customer command routing (~line 3873)
   - Update both help texts

2. **Database**: Add `pg_cron` job for Sunday weekly broadcast

