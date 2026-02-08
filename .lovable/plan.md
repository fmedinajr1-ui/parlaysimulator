# Multi-Sport Expansion: NHL, Tennis, and Team Props

## Status: ✅ Phase 1-4 Complete

---

## Completed

### ✅ Phase 1: Data Collection (Backend)
- [x] Created `game_bets` table for spreads, totals, moneylines
- [x] Created `tennis_player_stats` table for historical analysis
- [x] Extended `whale-odds-scraper` to fetch:
  - NHL player props (goals, assists, shots, saves)
  - Tennis player props (ATP/WTA - aces, double faults, games)
  - NFL/NCAAB player props
  - Team props: spreads, totals, h2h (moneylines)

### ✅ Phase 2: Analysis Engines
- [x] Extended `whale-signal-detector` for multi-sport:
  - Player prop divergence signals for all sports
  - Team prop sharp signals (spreads, totals, moneylines)
  - Sport-specific thresholds and scoring

### ✅ Phase 3: UI Components
- [x] Created `/team-bets` page with:
  - Sport tabs (NBA, NHL, NFL, NCAAB, NCAAF)
  - Bet type filters (Spreads, Totals, Moneylines)
  - Sharp signal indicators with grades
  - Real-time refresh

### ✅ Phase 4: Telegram Bot Integration
- [x] Added commands: `/nhl`, `/tennis`, `/spreads`, `/totals`
- [x] Updated `/start` help text with new commands

---

## Test Results

**Odds Scraper:** ✅ Working
- 324 player props collected
- 21 team bets collected
- Supports NBA, NHL, Tennis, NFL, NCAAB

**Signal Detector:** ✅ Working
- 13 player prop signals
- 6 team prop signals
- Multi-sport coverage active

---

## Remaining Work (Optional Enhancements)

### Tennis Stats Fetcher
- New edge function to pull ATP/WTA player historical stats
- Would enable sweet spot analysis for tennis

### AllSportsTracker Enhancement
- Add Tennis tab to existing tracker
- Show bet type breakdown

### Parlay Builder Updates
- Accept team props (spread/total/ML legs)
- Mix sports in same parlay

---

## API Sport Keys Reference

```
Basketball: basketball_nba, basketball_wnba, basketball_ncaab
Hockey: icehockey_nhl (normalized to hockey_nhl)
Football: americanfootball_nfl, americanfootball_ncaaf
Tennis: tennis_atp_*, tennis_wta_* (normalized to tennis_atp/tennis_wta)
```

## Database Tables

| Table | Purpose |
|-------|---------|
| `unified_props` | Player props from all sports |
| `game_bets` | Team props (spreads, totals, moneylines) |
| `tennis_player_stats` | Historical tennis player data |
| `whale_picks` | Sharp signals for both player and team props |

