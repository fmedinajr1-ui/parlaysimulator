

# NHL Prop Engine — Missing Data Layers for Composite Scores & Hit Rates

## What You Already Have
| Data Source | Status | Records |
|---|---|---|
| `nhl_player_game_logs` (skaters) | ✅ | 12,023 logs (Oct '25 → today) |
| `nhl_goalie_game_logs` | ✅ | 402 logs (Jan '26 → today) |
| `nhl_team_pace_stats` | ✅ | All 32 teams (shots, goals, save%, win%) |
| `nhl_team_defense_rankings` | ✅ | All 32 teams (goals/shots/PP/PK ranks) |
| NHL team composite scoring engine | ✅ | Moneyline, spread, total bets |

## What's Missing (6 Gaps)

### 1. NHL Player Prop Sweet Spots Scanner
**The big one.** NBA has `category_sweet_spots` populated by analyzers that scan L10 game logs, compute hit rates against lines, and flag players hitting props consistently. **No equivalent exists for NHL skater/goalie props.**

Need to build: An `nhl-prop-sweet-spots-scanner` that:
- Pulls today's NHL player prop lines from `unified_props` (shots on goal, goals, assists, points, saves)
- Cross-references each prop against `nhl_player_game_logs` / `nhl_goalie_game_logs` L10
- Calculates L10 hit rate, L10 avg, L10 median, L10 min/max, std dev
- Writes qualifying picks (e.g., 60%+ L10 hit rate) to `category_sweet_spots` with proper NHL categories

### 2. NHL Prop Categories
NBA has categories like `THREE_POINT_SHOOTER`, `SCORING_LEADER`, etc. Need NHL equivalents:
- `NHL_SHOTS_ON_GOAL` — SOG props (most common)
- `NHL_GOALS_SCORER` — Goals props
- `NHL_ASSISTS` — Assists props
- `NHL_POINTS` — Points (G+A) props
- `NHL_GOALIE_SAVES` — Goalie save props
- `NHL_BLOCKED_SHOTS` — Blocked shots props
- `NHL_POWER_PLAY_POINTS` — PP points props

### 3. NHL Prop-Specific Defense Rankings
`nhl_team_defense_rankings` has goals/shots ranks but not **prop-specific** ranks needed for the environment score engine. Missing:
- `opp_goals_allowed_rank` — Which teams give up the most goals (for goals props)
- `opp_shots_allowed_rank` — Already have `shots_against_rank`
- `opp_saves_faced_rank` — Teams that generate most shots (for goalie save props)
- `opp_power_play_goals_allowed_rank` — For PP points props

Can be derived from existing `nhl_team_pace_stats` + `nhl_team_defense_rankings` data.

### 4. NHL Environment Score Function
`calculateEnvironmentScore()` is NBA-only (pace 94-106 range, NBA prop routing). Need an NHL-specific version that:
- Routes SOG props → shots_against_rank
- Routes goals props → goals_against_rank
- Routes saves props → shots_for_rank of opponent (more shots = more save opportunities)
- Applies home ice advantage (weaker than NBA home court)
- Factors in back-to-back detection

### 5. NHL Mispriced Lines Detection
`detect-mispriced-lines` computes edge% by comparing L10 avg vs. book line, adjusted for defense. Currently NBA-focused. Need to:
- Add NHL player game log lookups for L10 averages
- Add NHL goalie game log lookups
- Apply NHL defense adjustments (shots_against_rank, goals_against_rank)
- Map NHL prop types to correct stat columns

### 6. NHL L10 Lookup in Parlay Generator
The `usePlayerL5Stats` hook and the parlay generator's L10 lookups only map NBA columns (`points`, `rebounds`, `assists`, `threes_made`). Need NHL mappings:
- `shots_on_goal` → SOG props
- `goals` → Goals props
- `assists` → Assists props
- `points` → Points props
- `saves` → Goalie saves (from `nhl_goalie_game_logs`)
- `blocked_shots` → Blocked shots props

## Implementation Plan

### Step 1: Create `nhl-prop-sweet-spots-scanner` edge function
- Query `unified_props` for today's NHL player props
- For each prop, query L10 from `nhl_player_game_logs` or `nhl_goalie_game_logs`
- Calculate hit rate, avg, median, min, max, std dev
- Assign NHL categories
- Upsert to `category_sweet_spots` with sport context
- This is the **core** — everything else builds on it

### Step 2: Add NHL prop-type routing to `calculateEnvironmentScore()`
- Detect NHL sport and route to NHL-specific defense ranks from `nhl_team_defense_rankings`
- Map: SOG → shots_against_rank, goals → goals_against_rank, saves → opponent shots_for_rank

### Step 3: Add NHL to `detect-mispriced-lines`
- Add NHL stat column mapping
- Query L10 from NHL game logs
- Apply NHL defense adjustments

### Step 4: Wire NHL sweet spots into parlay generator
- The generator already reads from `category_sweet_spots` generically
- Just needs NHL category weights in `bot_category_weights`
- And NHL environment score integration in the enrichment pass

### Files Changed
1. **`supabase/functions/nhl-prop-sweet-spots-scanner/index.ts`** (new) — core L10 scanner
2. **`supabase/functions/bot-generate-daily-parlays/index.ts`** — add NHL environment score routing + NHL category weights
3. **`supabase/functions/detect-mispriced-lines/index.ts`** — add NHL stat lookups
4. **`supabase/config.toml`** — register new function
5. **SQL migration** — seed NHL category weights into `bot_category_weights`

