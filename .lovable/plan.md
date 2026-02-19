
# Defense Filter Audit: Full Diagnosis + Precise Fix

## What We Found

Three distinct failures were confirmed through live log analysis and database inspection. Here is the exact evidence chain:

### Finding 1 — `playerTeamMap` resolves 0 mappings (confirmed in logs)

The live log from the run triggered today:
```
[PlayerTeamMap] Resolved 0 player→team mappings from game logs
```

The fix in `bot-generate-daily-parlays` queries `nba_player_game_logs` for `player_name, team_name` — but `nba_player_game_logs` has **no `team_name` column**. The schema is:

```
id, player_name, game_date, opponent, minutes_played, points,
rebounds, assists, threes_made, blocks, steals, turnovers,
is_home, field_goals_attempted, usage_rate, is_starter, ...
```

The query throws a Postgres error `column "team_name" does not exist`. The try/catch swallows the error silently and logs 0 mappings. Every pick then has `resolvedTeamName = ''`. The defense filter gets a blank team key, finds no opponent, and returns `null` for every single pick.

### Finding 2 — `category_sweet_spots` has no `game_description` column either

The audit plan from `.lovable/plan.md` referenced parsing `game_description` from `category_sweet_spots` as an alternative. That column does not exist. The actual columns on `category_sweet_spots` are: `id, category, player_name, prop_type, recommended_line, recommended_side, l10_hit_rate, archetype, analysis_date, ...`  — no team info whatsoever.

### Finding 3 — `nba_opponent_defense_stats` IS fresh (defense refresh worked)

The defense stats table was successfully refreshed today at `15:21:44 UTC`. Rankings are current for Feb 19, 2026. The data foundation is solid — only the team name resolution is broken.

### The Right Fix — Use `bdl_player_cache`

`bdl_player_cache` has 727 records with `player_name` + `team_name` and matches today's sweet spot players correctly:

```
Donte DiVincenzo  → Minnesota Timberwolves
Anthony Black     → Orlando Magic
Cooper Flagg      → Dallas Mavericks
Jamal Murray      → Denver Nuggets
Caleb Martin      → Dallas Mavericks
Jalen Johnson     → Atlanta Hawks
```

This is the correct source for the `playerTeamMap`. It's a roster cache that maps players to their current NBA team — exactly what the defense cross-reference needs.

---

## What Gets Fixed

### Fix 1 — Change the `playerTeamMap` source from `nba_player_game_logs` to `bdl_player_cache`

In `bot-generate-daily-parlays/index.ts` around line 2625:

**Before (broken):**
```typescript
const { data: playerTeamRows } = await supabase
  .from('nba_player_game_logs')
  .select('player_name, team_name')       // ❌ column does not exist
  .order('game_date', { ascending: false })
  .limit(5000);
```

**After (correct):**
```typescript
const { data: playerTeamRows } = await supabase
  .from('bdl_player_cache')
  .select('player_name, team_name')       // ✅ both columns exist, 727 rows
  .not('team_name', 'is', null);
```

No `.order()` or `.limit()` needed — `bdl_player_cache` is a flat roster cache, not a time-series log.

### Fix 2 — Confirm the defense filter log lines fire on next generation

After the fix, the next generation run should produce:
```
[PlayerTeamMap] Resolved ~700 player→team mappings from bdl_player_cache
[Bot] Intelligence data: 30 pace, 30 defense, ...
[DefenseMatchup] Applied composite adjustments to N NBA picks
[MasterParlay] N NBA candidates → M pass defense matchup filter
```

If `M < 4` on the master parlay filter, that means the matchup gate is legitimately blocking bad picks — which is correct behavior. The master parlay only builds if 4+ candidates survive.

---

## Files Changed

| File | Change | Location |
|---|---|---|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Change `playerTeamMap` query from `nba_player_game_logs` to `bdl_player_cache` | Lines 2625–2629 |

One line change. No schema changes. No migrations. The `bdl_player_cache` table already exists and has current data.

---

## Expected Outcome After Fix

| Intelligence Layer | Before Fix | After Fix |
|---|---|---|
| team_name resolved | ❌ 0 mappings (column missing) | ✅ ~700 player→team mappings |
| Defense composite adj | ❌ Always 0 (blank team key) | ✅ +8/+4/-10 applied per matchup |
| Master parlay filter | ❌ All picks pass (rank=null) | ✅ OVERs blocked vs rank 1–16, UNDERs blocked vs rank 17–30 |
| Defense data freshness | ✅ Updated today 15:21 UTC | ✅ Same, no change needed |

The defense intelligence layer will be fully operational for the first time on the next generation run after this single-line fix.
