

# Scanlines v2: FanDuel Game Markets + Pre-Game Alerts

## What you want
- Scan FanDuel **moneylines and totals** (not player props) across all sports
- Track **whale drift** (dramatic line movement through the day)
- Filter through existing data: KenPom for NCAAB, composite scores, whale signals
- **30 minutes before each game**, bot auto-sends a recommendation for the best matchup games

## What exists today
- `whale-signal-detector` already analyzes `game_bets` spreads/totals/moneylines for cross-book divergence → writes to `whale_picks`
- `detect-mispriced-lines` has a team moneyline block (lines 810-907) but averages ALL books, doesn't isolate FanDuel, no totals analysis, no drift
- `game_bets` stores FanDuel data with `bookmaker` field and `commence_time` per game
- `ncaab_team_stats` has KenPom (AdjO, AdjD, tempo, ATS, O/U records)
- `team-bets-scoring-engine` already computes composite scores per game
- No per-game timed alerts exist — everything runs on fixed cron schedules

## Implementation Plan

### 1. New table: `game_market_snapshots`
Stores timestamped FanDuel lines for drift tracking.

```sql
CREATE TABLE game_market_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  sport text NOT NULL,
  bet_type text NOT NULL, -- 'moneyline', 'total', 'spread'
  home_team text,
  away_team text,
  fanduel_line numeric,
  fanduel_home_odds integer,
  fanduel_away_odds integer,
  fanduel_over_odds integer,
  fanduel_under_odds integer,
  commence_time timestamptz,
  scan_time timestamptz DEFAULT now(),
  analysis_date date NOT NULL
);
CREATE INDEX idx_gms_date_game ON game_market_snapshots(analysis_date, game_id);
```

### 2. New edge function: `scanlines-game-markets`
Dedicated function (keeps `detect-mispriced-lines` focused on player props). Runs on cron 3x daily (10am, 12:30pm, 3pm ET — same as existing scan schedule).

**Logic:**
1. Query `game_bets` WHERE `bookmaker ILIKE '%fanduel%'` AND `commence_time > now()` for moneylines + totals
2. Insert snapshots into `game_market_snapshots`
3. Calculate drift by comparing current vs earliest snapshot for each game
4. For NCAAB: load `ncaab_team_stats` → compute KenPom projected total (`(AdjO + AdjD + AdjO_opp + AdjD_opp) / 2 * tempo_factor`) → edge vs FanDuel total
5. For all sports: cross-ref `whale_picks` for same game → convergence tag
6. Score each game market: base edge + drift magnitude + whale convergence + KenPom/data backing
7. Store top results to `mispriced_lines` with `prop_type = 'game_total'` or `'game_moneyline'` for scanlines reporting

### 3. New edge function: `pregame-scanlines-alert`
**The key new piece** — timed alerts 30 min before each game.

**Logic:**
1. Query `game_market_snapshots` for games with `commence_time` between `now()` and `now() + 45 minutes`
2. For each qualifying game, pull latest snapshot + earliest snapshot → drift analysis
3. Cross-ref `whale_picks` for convergence
4. For NCAAB: enrich with KenPom projected total, seed/rank context, ATS/O-U records
5. If game has a strong signal (edge ≥ 5%, or whale convergence, or dramatic drift ≥ 1.5pts), send Telegram alert

**Telegram output format:**
```
⏰ PRE-GAME ALERT — 30 min to tip
━━━━━━━━━━━━━━━━━━━━━━━━

🏀 12-McNeese vs 5-Clemson (7:00 PM ET)
📊 TOTAL UNDER 138.5 | Edge: +12%
   KenPom proj: 131.2 | Tempo: LOW
   📉 Drift: 141 → 138.5 (DRAMATIC)
   🐋 Whale convergence confirmed

💰 ML McNeese +260 | Edge: +8%
   KenPom gap: 22 (upset zone)
   📈 Drift: +310 → +260 (steam)
```

**Cron:** Runs every 15 minutes from 11am-11pm ET. Only sends alerts for games 25-35 min away that have actionable signals. Dedup: tracks sent alerts in a simple `Set` or DB flag to avoid repeats.

### 4. Update `/scanlines` Telegram handler
Add a "Game Markets" section to the existing `/scanlines` output:
- Query `game_market_snapshots` for today + `whale_picks` + `ncaab_team_stats`
- Display FanDuel moneylines and totals with drift trails
- Show convergence picks (data + drift + whale) first
- Keep existing player prop scanlines section below

### 5. Cron schedule additions
- **Every 15 min (11am-11pm ET):** `pregame-scanlines-alert` — checks for games starting in ~30 min
- **10am, 12:30pm, 3pm ET:** `scanlines-game-markets` — snapshot FanDuel game lines (piggyback on existing scan schedule)

## Files to create/edit
1. **DB migration**: `game_market_snapshots` table
2. **New**: `supabase/functions/scanlines-game-markets/index.ts` — FanDuel game market scanner + snapshot writer + drift calc + KenPom enrichment
3. **New**: `supabase/functions/pregame-scanlines-alert/index.ts` — per-game timed Telegram alerts 30 min before tip
4. **Edit**: `supabase/functions/telegram-webhook/index.ts` — add game markets section to `handleScanLines`
5. **Cron jobs**: 2 new scheduled jobs

## Sports coverage
| Sport | Moneyline | Totals | KenPom/Data | Whale Drift | Pre-Game Alert |
|-------|-----------|--------|-------------|-------------|----------------|
| NCAAB | Yes | Yes | KenPom + ATS | Yes | Yes |
| NBA | Yes | Yes | Composite scores | Yes | Yes |
| NHL | Yes | Yes | Pace stats | Yes | Yes |
| MLB | Yes | Yes | — | Yes | Yes |

