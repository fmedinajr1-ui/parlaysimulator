

## Plan: NHL Matchup Intelligence Filter

### Problem
The NHL prop scanner fetches `nhl_team_defense_rankings` but **never uses them**. `matchupAdjustment` is hardcoded to 0. The floor lock strategy picks purely on L10 hit rate — a player with 100% L10 against a bottom-5 defense gets the same weight as one facing the league's best. This is why accuracy is off.

### Solution
Wire defensive and offensive matchup scoring into the NHL scanner and the floor lock orchestrator, mirroring how NBA does prop-specific defense routing.

### Changes

#### 1. `nhl-prop-sweet-spots-scanner/index.ts` — Add matchup scoring

**Extract opponent from `game_description`** (format: "Team A vs Team B"). Cross-reference with `nhl_team_defense_rankings` to get the opponent's defensive profile.

**Prop-specific defense routing** (like NBA):
| Prop Type | Defense Rank Used | Offense Rank Used |
|-----------|------------------|-------------------|
| Goals | `goals_against_rank` | `goals_for_rank` |
| Assists/Points | `goals_against_rank` (proxy) | `goals_for_rank` |
| SOG | `shots_against_rank` | `shots_for_rank` |
| Saves | `shots_for_rank` (opp shoots more = more saves) | `shots_against_rank` |
| Blocked Shots | `shots_for_rank` (opp shoots more) | — |
| PP Points | `penalty_kill_rank` | `power_play_rank` (need PP rank added) |

**Compute `matchup_score`** per candidate:
```
matchup_score = (oppDefRank * 0.6) + ((31 - teamOffRank) * 0.4)
```
Where `oppDefRank` = opponent's weakness rank (higher = weaker defense = better for OVER) and `teamOffRank` = player's team offensive strength.

**Apply `matchup_adjustment`** to confidence:
- Elite matchup (score >= 22): +10 adjustment
- Prime matchup (score >= 18): +5
- Favorable (score >= 14): +2
- Neutral (10-14): 0
- Avoid (score < 10): -10
- Hard block OVER picks vs top-3 defenses in the specific stat category

**Persist** `matchup_adjustment`, `matchup_score`, and `opponent_abbrev` to `category_sweet_spots`.

#### 2. `nhl-floor-lock-daily/index.ts` — Filter by matchup quality

After fetching candidates, add a matchup filter layer before building parlays:

- **Floor Lock**: Exclude legs with `matchup_adjustment < -5` (avoid terrible matchups even with 100% L10)
- **Optimal Combo**: Weight combo scoring by `(hit_rate * 0.7) + (matchup_score_normalized * 0.3)` instead of pure hit rate product
- **Ceiling Shot**: Boost candidates with elite matchups, deprioritize avoid-tier
- **All strategies**: Add matchup context to Telegram broadcast per leg (e.g., "vs WAS (Rank 28 GA — Elite)")

#### 3. `nhl-team-defense-rankings-fetcher/index.ts` — Add `power_play_rank`

The table already stores `penalty_kill_rank` and `power_play_pct` but doesn't rank PP%. Add `power_play_rank` computation so PP Points props can route correctly.

### Files
1. `supabase/functions/nhl-prop-sweet-spots-scanner/index.ts` — matchup scoring engine
2. `supabase/functions/nhl-floor-lock-daily/index.ts` — matchup-aware candidate filtering + broadcast formatting
3. `supabase/functions/nhl-team-defense-rankings-fetcher/index.ts` — add `power_play_rank`

