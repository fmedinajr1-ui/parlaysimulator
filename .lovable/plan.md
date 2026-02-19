
# Bot Intelligence Audit: Defense Cross-Reference for Today's Parlays

## Verdict: The Defense Filter Exists But Is Firing Blind

The code is architecturally correct — `generateMasterParlay` and `buildPropPool` both query `nba_opponent_defense_stats` and call `getOpponentDefenseRank`. However, there are **three cascading failures** that mean today's parlays were built with zero effective defensive matchup intelligence:

---

## Failure 1 — Defense Stats Are 75 Days Stale (Most Critical)

The `nba_opponent_defense_stats` table was last updated **December 6, 2025**. Today is February 19, 2026. The defensive rankings being used are from Week 10 of the season — before the All-Star break, before major trades, before the mid-season lineup changes.

The engine is applying December ranks to February matchups. That means a team ranked #1 in December (e.g. Minnesota Timberwolves) might be #8 today after injuries. The entire foundation is wrong. Here is the actual data being used:

```
Minnesota Timberwolves — Rank 1  (defense rank from Dec 6, 2025)
Boston Celtics         — Rank 2
Oklahoma City Thunder  — Rank 3
Orlando Magic          — Rank 4
Cleveland Cavaliers    — Rank 5
```

Every +8 bonus and -10 penalty being applied to today's composite scores is based on 75-day-old data.

**Root cause:** The `fetch-team-defense-ratings` edge function updates this table, but it's not running frequently enough (or at all in the current cascade). Looking at `engine-cascade-runner/index.ts`, Step 3 does call `fetch-team-defense-ratings` — but the table is still showing December data. The function may not be writing to `nba_opponent_defense_stats` correctly, or may be failing silently.

---

## Failure 2 — `team_name` Is NULL on Every Player Pick (Silently Breaks Filter)

The database evidence is definitive. Every leg in today's execution parlays — including the master parlay — shows:

```
team_name: <nil>    defense_rank: <nil>    defense_adj: <nil>
```

The `category_sweet_spots` table has **no `team_name` column**. When `buildPropPool` maps sweet spots into `EnrichedPick` objects, it does `{ ...pick }` — but since `team_name` doesn't exist on `category_sweet_spots`, it spreads as `undefined`.

At line 3455 the defense adjustment code does:
```typescript
const teamKey = ((pick as any).team_name || '').toLowerCase().trim();
```

`teamKey` is always an empty string. `opponentMap.get('')` returns `undefined`. `getOpponentDefenseRank` immediately returns `null`. `getDefenseMatchupAdjustment(null, side)` returns `0`.

**Result:** Zero adjustments applied. Zero picks blocked. The defense filter is completely inert for every player prop pick built from `category_sweet_spots`.

The `game_description` field IS populated on `category_sweet_spots` (e.g. `"Indiana Pacers @ Washington Wizards"`), but it's never parsed to extract team names. This is the data that should be used.

---

## Failure 3 — The Master Parlay Used an Old Strategy Name

The master parlay in today's database shows `strategy_name: 'master_parlay_premium_boost'` — this is a variant from the premium boost builder, not the new `generateMasterParlay` function. The new function generated `null` because `validCandidates.length < 4` (defense filter returned null for all picks → everyone passed with rank=null → but then `team_name` was empty so `opponentMap.get('')` returned undefined, meaning rank was null for ALL picks, meaning everyone "passes" the matchup filter but the pick pool was below the hit-rate threshold or the master parlay was skipped for another reason).

---

## What the Fix Looks Like

### Fix 1 — Parse `game_description` to Extract `team_name`

`category_sweet_spots` has `game_description: "Indiana Pacers @ Washington Wizards"`. Parse this in `buildPropPool` to extract which team the player belongs to by matching the player's team from `nba_player_game_logs` or by splitting the game description string and cross-referencing the opponent map.

The simplest path: query `nba_player_game_logs` to get `team_name` for each player and build a `playerTeamMap` before enriching sweet spots.

```typescript
// Before enriching sweet spots:
const { data: playerTeams } = await supabase
  .from('nba_player_game_logs')
  .select('player_name, team_name')
  .order('game_date', { ascending: false });

const playerTeamMap = new Map<string, string>();
for (const row of playerTeams || []) {
  const key = (row.player_name || '').toLowerCase();
  if (!playerTeamMap.has(key)) {  // Keep most recent team only
    playerTeamMap.set(key, row.team_name);
  }
}
```

Then during enrichment:
```typescript
const resolvedTeamName = pick.team_name || 
  playerTeamMap.get(pick.player_name?.toLowerCase()) || '';
```

### Fix 2 — Refresh `nba_opponent_defense_stats` Daily

The `fetch-team-defense-ratings` edge function needs to be verified and its output confirmed to write to `nba_opponent_defense_stats`. Either:
- Confirm it's in the engine cascade and writing correctly
- Or add a dedicated daily refresh that pulls current season defensive ratings per team per stat category (points, rebounds, assists, threes allowed)

The current data (Dec 6) is too stale to provide any real edge — it may actually be hurting picks by applying wrong bonuses/penalties.

### Fix 3 — Add `team_name` as a Derived Column in the Sweet Spots Query

When `buildPropPool` queries `category_sweet_spots`, join against `nba_player_game_logs` to pull the most recent `team_name` per player in the same query:

```sql
SELECT css.*, 
  (SELECT gl.team_name FROM nba_player_game_logs gl 
   WHERE gl.player_name = css.player_name 
   ORDER BY gl.game_date DESC LIMIT 1) as team_name
FROM category_sweet_spots css
WHERE ...
```

---

## Files to Change

| File | Change |
|---|---|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Build `playerTeamMap` from `nba_player_game_logs` before enrichment. Use it to resolve `team_name` on every sweet spot pick. |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | In the sweet spot query (around line 2622), add resolved `team_name` to each EnrichedPick using `playerTeamMap`. |
| `supabase/functions/fetch-team-defense-ratings/index.ts` | Audit why `nba_opponent_defense_stats` is 75 days stale. Fix the write path so fresh ranks are persisted after each run. |

---

## Summary: What Today's Parlays Actually Used

| Intelligence Layer | Should Be Used | Actually Used |
|---|---|---|
| L10 hit rate | ✅ Yes | ✅ Yes |
| Category archetype weights | ✅ Yes | ✅ Yes |
| Injury blocklist | ✅ Yes | ✅ Yes |
| Game context (B2B, blowout) | ✅ Yes | ⚠️ Partially (team_name null = no match) |
| Opponent defense rank | ✅ Yes | ❌ No (team_name null = rank always null) |
| Defensive matchup filter (master parlay) | ✅ Yes | ❌ No (null rank = everyone passes, wrong pool) |
| Defense composite adjustment | ✅ Yes | ❌ No (adj always 0) |
| Stale defense data | Fresh Feb data | ❌ Dec 6, 2025 data (75 days old) |

The picks being generated are good picks by hit-rate standards. The defense filter simply isn't activating. Fix the `team_name` resolution and refresh the defense stats table and the engine will be properly cross-referencing today's matchups for the first time.
