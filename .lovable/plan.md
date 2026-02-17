
# KenPom/PAE Integration Audit: What's Actually Being Used

## Short Answer

The KenPom/PAE data is being used — but **only for team bets (spreads, totals, moneylines)** in the `team-bets-scoring-engine`. It is **not connected to player props** at all, which is exactly the gap your question describes.

---

## What IS Wired Up (Team Bets)

The `team-bets-scoring-engine` is the only function that consumes PAE data, and it does so correctly for game-level bets:

| Usage | Where | How |
|---|---|---|
| AdjO / AdjD efficiency matchup | Spreads, Moneylines | `homeNetAdv = (homeOff - awayDef) - (awayOff - homeDef)` → score bonus ±15 pts |
| Projected total vs. posted line | Totals | `projectedTotal = (homeOff + awayOff) * tempoFactor / 100 * 2` → detects inflated/undervalued lines |
| Tempo vs. OVER/UNDER alignment | Totals | Tempo <62 or >72 mismatch = -12 penalty; fast tempo OVER = +18 max |
| PAE rank tier bonus | All | Top-25 rank = +10, Top-50 = +7, rank >200 = -15 |
| Cold/hot L5 team detection | Totals | >10% below season avg = "cold" → OVER -10 / UNDER +5 |

The PAE formula is fully populated for all 362 D1 teams (confirmed: 362 rows, source=`pae_formula`, avg tempo 65.9).

---

## What is NOT Wired Up (Player Props — the Gap)

The `prop-engine-v2` — which handles all player props — **does not load `ncaab_team_stats` at all.** It has zero connection to:

- Game tempo (which determines how many possessions a player gets)
- Defensive efficiency of the opponent (which determines whether a points/assists/rebounds prop is inflated or undervalued)
- KenPom rank of either team

The `prop-engine-v2`'s SES (Sharp Edge Score) is based entirely on:
1. **Median gap** (40%) — line vs. rolling L10 median
2. **Line structure** (20%) — .0 vs. .5
3. **Minutes certainty** (15%) — avg minutes bracket
4. **Market type** (15%) — Standard vs. Goblin vs. Demon
5. **Blowout/pace** (10%) — uses the betting spread, not PAE tempo

There are also 199 active NCAAB props in `unified_props` today that currently have no PAE-based filtering at all — they go through the generic pipeline with no game-environment awareness.

---

## The Exact Logic You Described vs. What Exists

| Your Described Logic | Current Status |
|---|---|
| Use KenPom AdjO/AdjD to identify games where efficiency differs from market total | ✅ Exists — but only for TEAM totals bets |
| Use tempo to decide OVER vs. UNDER for player counting stats | ❌ Not wired into prop-engine-v2 |
| Cross-check player props against opponent defensive rank by position | ❌ Not wired into prop-engine-v2 |
| Surface "mismatches" where posted line is out of step with PAE-implied environment | ❌ Not wired into prop-engine-v2 |
| High-tempo two-team game → better environment for points/rebounds overs | ❌ Not implemented for player props |

---

## The Fix: PAE Game Context Layer for Prop Engine v2

To implement this, the prop engine needs a new `game_context` input block populated from `ncaab_team_stats`. This would add a **6th SES component**: "Game Environment Score."

### Data Sources Already Available

- `ncaab_team_stats` → `kenpom_adj_o`, `kenpom_adj_d`, `adj_tempo`, `kenpom_rank` for all 362 teams
- `unified_props` → `game_description` contains opponent team name for each NCAAB prop
- `prop_engine_v2/index.ts` → `opponent_name` is already in the `PropInput` interface

### New Scoring Logic (Game Environment Score, max 10 pts replacing current blowout/pace)

For NCAAB player prop **overs on counting stats** (points, rebounds, assists):

```
tempo_avg = (player_team_tempo + opponent_tempo) / 2

if tempo_avg > 69 → +8 (fast game, more possessions, counting stats inflate)
if tempo_avg > 67 → +5
if tempo_avg < 63 → -6 (slow grind, fewer possessions, unders get boost)

if opponent_adj_defense > 105 → -4 (strong defense = harder for player to hit over)
if opponent_adj_defense < 97 → +4 (weak defense = favorable for overs)

if player_team_adj_offense > 125 → +3 (elite offense = player gets better looks)
```

For **unders**: mirror logic (slow tempo and strong defense = UNDER-favorable environment).

### Implementation Plan

**Step 1 — Enrich `prop-engine-v2/index.ts`**

At the start of the `full_slate` handler, after fetching `approvedProps`, load NCAAB team stats into a lookup map:

```typescript
const { data: ncaabStats } = await supabase
  .from('ncaab_team_stats')
  .select('team_name, kenpom_adj_o, kenpom_adj_d, adj_tempo, kenpom_rank');

const ncaabMap = new Map(ncaabStats?.map(t => [t.team_name.toLowerCase(), t]) ?? []);
```

**Step 2 — Extend `PropInput` interface**

Add an optional `game_context` field:

```typescript
interface GameContext {
  team_tempo?: number;
  opp_tempo?: number;
  team_adj_offense?: number;
  opp_adj_defense?: number;
  team_kenpom_rank?: number;
  opp_kenpom_rank?: number;
}
// Add to PropInput:
game_context?: GameContext;
```

**Step 3 — Populate `game_context` when building NCAAB props**

When iterating over `approvedProps`, if sport is NCAAB, look up both teams in `ncaabMap` and attach the context.

**Step 4 — Replace blowout/pace component in `calculateSES`**

Extend the existing 10-point "blowout/pace" component to factor in PAE game context when available. If no PAE data exists, fall back to current spread-based logic.

**Step 5 — Update `key_reason` generation**

Surface the tempo/efficiency context in the human-readable reason string, e.g.:
- `"Elite tempo game (avg 71.2 poss) boosts counting stats — Line 2.1 below median"`
- `"Grind matchup (avg 62.8 poss) suppresses overs — UNDER favored by environment"`

---

## Files to Change

1. **`supabase/functions/prop-engine-v2/index.ts`** — Main change: add PAE lookup, new `GameContext` type, update `calculateSES`, update `generateKeyReason`
2. No database migrations needed — all required data already exists in `ncaab_team_stats`

---

## Technical Notes

- The `team_name` and `opponent_name` fields in `PropInput` are already populated for props coming from the Risk Engine — the PAE lookup just needs a fuzzy match on those names
- The PAE formula covers all 362 D1 teams, so coverage will be near 100% for NCAAB props
- This change only affects the NCAAB-sourced props path; NBA props continue to use the existing NBA-specific pace data
- The SES weight distribution does not change (max score stays 100) — the existing blowout/pace component is extended, not replaced
