

# Mega Parlay + Stolen Bases Investigation

## Findings

### Mega Parlay: Why 0 parlays generated

Two issues identified:

1. **No NBA games today** — The scanner found 8 NBA events from the Odds API but ALL 8 have commence times that don't match today (April 13) in Eastern Time. They're likely tomorrow's games. When there are no games today, the scanner correctly produces 0 props → 0 tickets. This is expected behavior, not a bug.

2. **Previous `const` crash (now fixed)** — Earlier runs hit `TypeError: Assignment to constant variable` at line 842 (compiled). The `let scoredProps` fix from the last edit resolved this — the 21:21:49 run completed without errors. However it still produced 0 tickets because of #1 above.

3. **Fallback also empty** — The `unified_props` fallback returned 0 NBA props too, confirming there's genuinely no NBA slate today.

**Verdict**: Mega parlay scanner is working correctly. It will generate tickets when there are NBA games.

### Stolen Bases: Data is completely broken

Critical finding — **all 4,008 game logs since April 1 show `stolen_bases = 0`**. Every single player, every single game. The SB column exists in `mlb_player_game_logs` but the data is never being populated from the source API.

Meanwhile, `unified_props` has active FanDuel SB lines (0.5) for players like Victor Scott II, Jose Ramirez, James Wood, etc. — but there's no actual outcome data to settle against.

**This means**:
- We cannot validate SB accuracy because there's no real data
- Any SB alerts would be impossible to settle
- The `mlb-rbi-settler` doesn't handle SB props anyway

## Plan

### 1. Fix stolen bases data ingestion
- Identify which edge function populates `mlb_player_game_logs` (likely an MLB game log fetcher)
- Verify the source API returns SB data and map it to the `stolen_bases` column
- Backfill existing game logs with correct SB data

### 2. Build SB settler
- Extend `mlb-rbi-settler` (or create `mlb-sb-settler`) to settle `batter_stolen_bases` alerts
- Logic: Over 0.5 SB → correct if `stolen_bases >= 1`, Under 0.5 SB → correct if `stolen_bases == 0`

### 3. Create SB alert system (after data is verified)
- Add SB analysis to `hrb-mlb-rbi-analyzer` or create a dedicated analyzer
- Use L10 SB averages to identify high-probability Under 0.5 SB picks (most players don't steal bases — Under should be heavily favored)
- Apply similar gates: L10 avg range, hit rate threshold, dedup

### 4. Add a "no games today" clean exit for mega parlay
- When 0 events match today's date, log a clean message and skip the Telegram error alert
- This prevents the pipeline from reporting a false "failure" on off-days

### Technical details
- **SB ingestion**: Need to inspect the MLB game log fetcher function to find where `stolen_bases` is mapped
- **SB base rates**: With the 0.5 line, Under is likely 85%+ accurate across all players — only ~15% of player-games result in a stolen base. This makes it a strong signal category if data is fixed.
- **Mega parlay**: No code changes needed for the scanner itself — just the clean exit messaging

