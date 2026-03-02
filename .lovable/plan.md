
I investigated the `/lookup` pipeline and found why the defensive matchup section is still missing.

## What’s causing it

The current logic only builds the defensive matchup section when this query returns rows:

- `unified_props` filtered by `player_name` + today date (`created_at >= today`)

If that query returns no rows for that player, `opponentAbbrev` never gets set, so this section is omitted entirely:
- `🛡️ Tonight's Matchup ...`

I confirmed this with live data:
- `unified_props` has **no current rows** for players you tested (e.g. Jalen Suggs, Jonathan Kuminga)
- `game_bets` **does** have the NBA game data (example: Orlando vs Detroit), so matchup info exists in backend but isn’t being used by `/lookup`
- `team_defense_rankings` has valid current defensive rank rows

So this is a lookup-opponent resolution issue, not a defensive-rank-table issue.

## Implementation plan

### 1) Refactor opponent resolution in `handleLookup` (primary fix)
File: `supabase/functions/telegram-webhook/index.ts`

Create a deterministic opponent-resolution flow that does **not** depend only on `unified_props`:

1. Resolve canonical player (already done via game logs)
2. Resolve player team from `bdl_player_cache` (new step)
   - query `player_name, team_name, is_active`
   - prefer active exact/closest match
   - normalize with existing `resolveTeamAbbrev`
3. Resolve opponent by priority:
   - **Priority A:** from `todayProps[0].game_description` using `extractOpponentFromGameDesc(gameDesc, playerTeamAbbrev)` when available
   - **Priority B (new fallback):** from today’s `game_bets` NBA games by matching player team to `home_team`/`away_team` and selecting the opposite team
4. Use resolved opponent to fetch from `team_defense_rankings` and build `defenseSection`

### 2) Decouple defense section from props section
Keep “Today’s Props” optional, but make defensive matchup independent:
- If opponent found: always show defensive ranking block
- If no opponent found: show explicit fallback text (example: “No NBA matchup detected for today”), instead of silently omitting the section

### 3) Improve reliability and debuggability
Add concise logs inside `/lookup`:
- matched player
- resolved player team
- todayProps count
- opponent source used (`props` vs `game_bets`)
- final opponent abbreviation found/not found

This will make future “not showing” reports diagnosable immediately in function logs.

### 4) Keep existing long-message behavior intact
Do not change the recent long-message fix:
- continue sending final lookup response via `sendLongMessage`
- keep full available L10 rows as-is

## Expected result after fix

For players with a scheduled NBA game but no active prop rows:
- `/lookup` will still show:
  - L10 game log + averages
  - Defensive matchup block with ranks (overall, vs PTS/3PT/REB/AST)
- “Today’s Props” block will appear only when props exist

## Technical change outline

```text
Current:
todayProps -> infer opponent -> defenseSection

New:
playerTeam (bdl_player_cache)
    + (todayProps game_description if available)
    + fallback game_bets schedule
=> opponentAbbrev
=> defenseSection (independent of propsSection)
```

## Validation checklist (after implementation)

1. `/lookup Jalen Suggs`
   - should show defensive matchup (ORL opponent from game schedule)
   - props block may be absent if no lines
2. `/lookup LeBron James`
   - should show both defensive matchup and props block
3. `/lookup Jonathan Kuminga`
   - if no game today, should show explicit “no matchup today” fallback line
4. Confirm logs show opponent source and resolved abbreviation for each request

No database migration is required; this is function-logic only.
