

## Perfect Line Catcher — Matchup-Aware Line Value Engine

### The Concept

Right now your system detects *line movement* but doesn't cross-reference it with *historical player performance vs that specific opponent*. The idea: when FanDuel posts a line for "Jayson Tatum O 27.5 pts", the system should instantly check his historical stats vs that opponent (e.g., he averages 31.2 pts vs CHA with a 4/5 over rate) and flag it as a **Perfect Line** — a mispriced entry where history says the book is wrong.

### What We Have Already

- **`matchup_history`** table: `player_name`, `opponent`, `prop_type`, `avg_stat`, `min_stat`, `max_stat`, `games_played`, `hit_rate_over`, `hit_rate_under`
- **`fanduel_line_timeline`** table: real-time FanDuel lines with `player_name`, `prop_type`, `line`, `over_price`, `under_price`
- **`nba_player_game_logs`**: granular game-by-game data with points, rebounds, threes, assists vs each opponent

### Plan

#### 1. New Edge Function: `perfect-line-scanner`

Cross-references today's FanDuel lines against matchup history to find mispriced lines.

**Logic:**
- Fetch all current FanDuel lines (latest snapshot per player/prop)
- For each line, look up `matchup_history` for that player vs today's opponent
- Calculate **Line Gap** = `avg_stat - line` (positive = book is too low)
- Calculate **Floor Safety** = `min_stat - line` (positive = player ALWAYS clears)
- Calculate **Hit Rate** from `hit_rate_over` / `hit_rate_under`
- Score each line into tiers:
  - **PERFECT LINE** (🟢): avg > line by 15%+ AND min >= line AND games >= 3 AND hit rate >= 80%
  - **STRONG EDGE** (🔵): avg > line by 10%+ AND hit rate >= 65%
  - **LEAN** (🟡): avg > line by 5%+ AND hit rate >= 55%
- Works for points, threes, AND rebounds
- Returns sorted list with best opportunities first

#### 2. Integrate Into `fanduel-prediction-alerts`

Add a new signal type `perfect_line` that fires as a **P0 (highest priority)** alert — these go out FIRST, before any movement-based signals.

- When the scanner finds a Perfect Line or Strong Edge, format a Telegram alert:
  ```
  🎯 PERFECT LINE DETECTED
  Jayson Tatum OVER 27.5 Points (-110)
  📊 vs CHA: 31.2 avg | 4/5 over | Floor: 28
  🔥 Historical: 80% hit rate (4/5 games)
  ✅ Gap: +3.7 pts above line
  ```
- Fire these as soon as lines appear (no need to wait for movement)

#### 3. Enhanced Game Log Cross-Reference

For deeper accuracy, also query `nba_player_game_logs` directly to get:
- Last 3 games vs this specific opponent (recency matters)
- Home/away split vs opponent
- Whether the player was a starter in those games

This adds a **recency weight** — if a player scored 35, 32, 29 in their last 3 vs CHA, that's stronger than a 5-game average of 28.

#### 4. Cron Schedule

Run `perfect-line-scanner` every 30 minutes during scan hours (10 AM–7 PM ET) so it catches lines as soon as FanDuel posts them — before movement happens.

### Files to Create/Edit

| File | Action |
|------|--------|
| `supabase/functions/perfect-line-scanner/index.ts` | **Create** — core matchup vs line cross-reference engine |
| `supabase/functions/fanduel-prediction-alerts/index.ts` | **Edit** — add P0 perfect_line signal type, fire before movement signals |
| DB migration | **Create** — add `pg_cron` job for 30-min scans |

### Key Technical Detail

The scoring formula per prop:

```text
edge_score = (avg_stat - line) / line × 100    # % above line
floor_gap  = min_stat - line                    # safety margin
hit_rate   = hit_rate_over (or under)           # from matchup_history

tier = PERFECT  if edge_score >= 15 AND floor_gap >= 0 AND hit_rate >= 0.80
     = STRONG   if edge_score >= 10 AND hit_rate >= 0.65
     = LEAN     if edge_score >= 5  AND hit_rate >= 0.55
```

This ensures we only alert on lines where the book is genuinely mispriced against historical matchup data — no traps, no guessing.

