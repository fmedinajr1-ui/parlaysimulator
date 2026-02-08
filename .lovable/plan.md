

# Multi-Sport Expansion: NHL, Tennis, and Team Props

## Overview

You're currently focused on **NBA player props**. This plan expands the platform to support:

1. **NHL player props** (goals, assists, shots on goal, saves)
2. **Tennis player props** (ATP/WTA - games, aces, double faults)  
3. **Team/Game props** (spreads, totals, moneylines) for all supported sports

## Current State

Your infrastructure is surprisingly ready for this:
- The `unified_props` table already supports a `sport` column (currently only `basketball_nba`)
- The `whale-odds-scraper` already fetches NHL props (`hockey_nhl`)
- The `whale-signal-detector` already includes `tennis_atp` and `tennis_wta` in its default sports list
- You have an `nhl-stats-fetcher` that collects NHL player game logs
- The `AllSportsTracker` component already has tabs for NHL, NFL, MLB, UFC

## What's Missing

| Gap | Description |
|-----|-------------|
| Tennis odds fetching | No scraper currently pulls tennis player props from The Odds API |
| Team/game props | Only player props are stored - spreads, totals, moneylines aren't captured |
| NHL/Tennis analysis | No sweet spot or risk engine analysis for non-NBA sports |
| UI for new props | Dashboards are NBA-focused with hardcoded stat types |

---

## Implementation Plan

### Phase 1: Data Collection (Backend)

**1.1 Extend the Odds Scraper for All Sports + Bet Types**

Update `whale-odds-scraper` to fetch:
- Tennis player props: `tennis_atp`, `tennis_wta` 
- Team props: `spreads`, `totals`, `h2h` (moneylines) for NBA, NHL, NFL, NCAAB

Add new markets:
```
Tennis: player_aces, player_double_faults, player_games_won
NHL: player_goals, player_assists, player_shots_on_goal, player_saves  
Team: spreads, totals, h2h
```

**1.2 Create Team Props Table**

New `game_bets` table to store team-level bets:
- `game_id`, `sport`, `bet_type` (spread/total/moneyline)
- `home_team`, `away_team`, `line`, `home_odds`, `away_odds`
- `bookmaker`, `commence_time`

**1.3 Add Tennis Stats Fetcher**

New edge function `tennis-stats-fetcher` to pull player stats from ESPN Tennis API for historical analysis.

---

### Phase 2: Analysis Engines

**2.1 Multi-Sport Signal Detector**

Extend `whale-signal-detector` to:
- Process NHL divergence signals (book vs book comparison)
- Process tennis divergence signals
- Generate signals for team props (sharp money detection on spreads/totals)

**2.2 Sport-Specific Sweet Spot Categories**

Add new category mappings:
| Sport | Categories |
|-------|------------|
| NHL | `GOAL_SCORER`, `PLAYMAKER`, `SHOT_VOLUME`, `GOALIE_SAVES` |
| Tennis | `ACE_MACHINE`, `TIGHT_MATCHER`, `SERVICE_HOLD` |
| Team | `SHARP_SPREAD`, `OVER_TOTAL`, `UNDER_TOTAL`, `ML_UNDERDOG` |

---

### Phase 3: UI Components

**3.1 Universal Props Dashboard**

New `/all-props` page with:
- Sport selector: NBA | NHL | Tennis | All
- Bet type tabs: Player Props | Spreads | Totals | Moneylines
- Unified card display showing confidence scores and signals

**3.2 Team Bets Dashboard**

New `/team-bets` page featuring:
- Today's game spreads with sharp money indicators
- Over/Under totals with pace analysis
- Moneyline value plays with implied probability comparison

**3.3 Enhanced AllSportsTracker**

Add Tennis tab and show bet type breakdown in the existing tracker.

---

### Phase 4: Integration

**4.1 Parlay Builder Support**

Update the universal parlay builder to:
- Accept team props (spread/total/ML legs)
- Mix sports in same parlay (NBA player + NHL total)
- Calculate combined odds correctly

**4.2 Telegram Bot Commands**

New commands:
- `/nhl` - Today's NHL player props
- `/tennis` - ATP/WTA picks
- `/spreads` - Team spread recommendations
- `/totals` - Over/Under picks

---

## Technical Details

### Database Changes

```sql
-- New table for team-level bets
CREATE TABLE game_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  bet_type TEXT NOT NULL, -- 'spread', 'total', 'h2h'
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  line NUMERIC,
  home_odds NUMERIC,
  away_odds NUMERIC,
  over_odds NUMERIC,
  under_odds NUMERIC,
  bookmaker TEXT NOT NULL,
  commence_time TIMESTAMPTZ NOT NULL,
  sharp_score NUMERIC,
  recommended_side TEXT,
  signal_sources JSONB,
  is_active BOOLEAN DEFAULT true,
  outcome TEXT,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, bet_type, bookmaker)
);

-- Tennis player stats table
CREATE TABLE tennis_player_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  match_date DATE NOT NULL,
  opponent TEXT,
  tournament TEXT,
  surface TEXT, -- hard, clay, grass
  aces INTEGER,
  double_faults INTEGER,
  first_serve_pct NUMERIC,
  games_won INTEGER,
  games_lost INTEGER,
  sets_won INTEGER,
  sets_lost INTEGER,
  is_winner BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_name, match_date, opponent)
);
```

### Edge Functions to Create/Modify

| Function | Action |
|----------|--------|
| `whale-odds-scraper` | Add tennis sports, add team markets |
| `tennis-stats-fetcher` | New - fetch ATP/WTA player stats |
| `multi-sport-analyzer` | New - analyze props across all sports |
| `team-bet-signal-detector` | New - sharp signals for spreads/totals |

### API Sport Keys (The Odds API)

```text
Tennis: tennis_atp_french_open, tennis_wta_us_open, etc.
NHL: icehockey_nhl
NFL: americanfootball_nfl
NCAAB: basketball_ncaab
```

---

## Rollout Sequence

```text
Week 1: Phase 1 (Data Collection)
  - Update odds scraper for all sports
  - Create game_bets table
  - Start collecting NHL + Tennis props

Week 2: Phase 2 (Analysis)
  - Extend signal detector
  - Add sport-specific categories
  - Build confidence scoring for new sports

Week 3: Phase 3 (UI)
  - Build All Props dashboard
  - Build Team Bets dashboard
  - Update tracker

Week 4: Phase 4 (Integration)
  - Parlay builder updates
  - Telegram commands
  - Testing and refinement
```

---

## Risk Considerations

- **API Usage**: Tennis has many tournaments - The Odds API calls will increase significantly
- **Data Quality**: Tennis player name matching is harder (accents, transliterations)
- **Analysis Accuracy**: No historical data yet for NHL/Tennis to calibrate models
- **PrizePicks Coverage**: PP may not offer all the sports/markets you want

## Recommendation

Start with **NHL player props** first since you already have:
- Stats fetcher working (`nhl-stats-fetcher`)
- Odds scraper configured (`whale-odds-scraper` includes `hockey_nhl`)
- Basic UI support in `AllSportsTracker`

Then expand to Tennis and Team props in subsequent phases.

