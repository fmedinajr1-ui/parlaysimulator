
I investigated why you still don’t see matchup rankings and found a new root cause in the current `/lookup` fallback logic.

## What I confirmed

1. The webhook is receiving your requests and resolving player/team correctly:
- Logs show entries like:
  - `player=Jalen Suggs, playerTeam=ORL`
  - `todayProps count=0`
  - `opponentAbbrev=null, source=none`

2. Defensive rank data exists and is current:
- `team_defense_rankings` has valid rows (example: DET, ORL with current ranks).

3. Schedule data exists for the same date:
- For ET date `2026-03-01`, `game_bets` has ORL vs DET.
- But the table contains duplicate rows per game (about 9 rows per game / bookmaker).
- In that same day window: ~90 rows but only 10 unique games.

## Why it still fails

The current fallback query in `handleLookup` can still miss the player’s game because:

- It fetches raw `game_bets` rows with duplicates and only `.limit(50)`.
- It does not deduplicate by `game_id`.
- It uses a UTC calendar-day window (`00:00–23:59`) which can miss late-night ET games that fall after midnight UTC.
- If no row for the player’s game is present in that limited sample, `opponentAbbrev` stays null and matchup section is skipped.

## Implementation plan

### 1) Make schedule window ET-safe (noon-to-noon)
**File:** `supabase/functions/telegram-webhook/index.ts`

- Add a helper similar to the scanner function to produce:
  - `startUtc` = noon ET today
  - `endUtc` = noon ET tomorrow
- Use this range for the `game_bets` fallback query.

This avoids missing “tonight” games that are on next UTC date.

### 2) Fix fallback query to fetch unique games reliably
In `handleLookup`, replace the current raw/limited fallback query logic with:

- Select: `game_id, home_team, away_team, commence_time`
- Filter:
  - `.eq('sport', 'basketball_nba')`
  - `.gte('commence_time', startUtc)`
  - `.lt('commence_time', endUtc)`
- Use a safer row cap (e.g. `limit(500)`) to avoid cutting off valid games.
- Deduplicate rows in code by `game_id` before team matching.

Then match `home/away` team abbreviations against `playerTeamAbbrev` to resolve opponent.

### 3) Add explicit query error + count logs
Add logging in `/lookup` for:
- schedule window values (`startUtc`, `endUtc`)
- `todayGames` raw row count
- unique game count after dedupe
- query error messages (if any)
- final `opponentAbbrev` + source

This will prevent silent failures and make future debugging immediate.

### 4) Ensure both defensive and offensive rankings appear (when opponent resolved)
Because you asked about defensive/offensive ranking, update matchup rendering to include both from `team_defense_rankings`:

- Defensive: existing lines (`overall`, `opp_points_rank`, `opp_threes_rank`, `opp_rebounds_rank`, `opp_assists_rank`)
- Offensive: add lines from:
  - `off_points_rank`
  - `off_threes_rank`
  - `off_rebounds_rank`
  - `off_assists_rank`
  - `off_pace_rank`

If opponent is unresolved, keep explicit fallback text:
- `No NBA matchup detected for today.`

## Expected outcome

After this change:
- `/lookup Jalen Suggs` should resolve ORL matchup from schedule and show rankings.
- `/lookup Jonathan Kuminga` should show matchup only if GSW has a game in ET “today” window; otherwise clear no-matchup message.
- Late ET games (post-midnight UTC) will still be detected correctly.
- Rankings section becomes deterministic instead of intermittently missing.

## Technical patch scope

Single file only:
- `supabase/functions/telegram-webhook/index.ts`

Primary edit areas:
- Date/window helper near existing date utilities.
- `/lookup` fallback block around current lines ~3398–3425.
- Matchup output block around ~3436–3445 to include offensive ranks.
- Additional logs in lookup path.

## Validation checklist

1. `/lookup Jalen Suggs`
   - Should show opponent (DET) and defensive/offensive ranking block.
2. `/lookup LeBron James` (or another player with active props)
   - Should still work with props path and show rankings.
3. `/lookup` on a late-night ET game player
   - Should resolve opponent despite UTC date rollover.
4. Review logs
   - Confirm non-zero schedule rows, unique game count, and resolved source (`game_bets` or `props`).
