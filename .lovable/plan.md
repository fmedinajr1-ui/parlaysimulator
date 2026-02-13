

# Focus Team Bets on NCAAB: Moneylines, Totals, and Spreads

## What We're Building

Since there's no NBA today (All-Star break), we'll tighten the NCAAB team prop pipeline to produce higher-quality picks by enriching the existing data with KenPom-style intelligence and improving the UI to default to NCAAB.

## Current State

- **39 active NCAAB game_bets** across spreads, totals, and moneylines for tonight's slate
- **200 teams** enriched in `ncaab_team_stats` with offense, defense, and tempo ratings
- The composite scoring engine already handles NCAAB-specific logic (efficiency differentials, tempo-based totals, home court weighting, conference game penalties)
- **Problem 1**: Team name mismatches -- game_bets has "Michigan St Spartans" but ncaab_team_stats has "Michigan State Spartans", causing the scoring engine to miss data and return flat 55 scores
- **Problem 2**: UNLV Rebels has no stats data at all (null offense/defense/tempo)
- **Problem 3**: The Team Bets page defaults to "ALL" sports, burying NCAAB picks among empty NBA/NHL slots
- **Problem 4**: Totals lack Over/Under direction labels (same issue we just fixed for parlays)

## Plan

### 1. Fix NCAAB Team Name Fuzzy Matching (backend function)

Update `bot-generate-daily-parlays` to normalize team names before looking up `ncaab_team_stats`. Add a mapping layer that handles common abbreviation mismatches:
- "Michigan St" -> "Michigan State"
- "UConn" -> "Connecticut"
- Other known ESPN abbreviations

This ensures the composite scoring engine gets real KenPom data instead of falling back to flat 55 scores.

### 2. Default Team Bets Page to NCAAB

When no NBA games exist (like today), auto-detect and default the sport filter to NCAAB. This surfaces tonight's college basketball slate immediately instead of showing "No upcoming games."

### 3. Add Over/Under Direction to Team Bet Cards

For totals bets, display "Over 152.5" or "Under 152.5" in the pick banner and odds display, matching what we did for parlays.

### 4. Enrich Team Bet Cards with KenPom Context

Add a small contextual line showing the key scoring factor for each pick:
- Spreads: "Efficiency edge: +12.3 pts"
- Totals: "Combined tempo: 73.2 (fast)"  
- Moneylines: "Rank #16 vs #47, home court"

This gives users confidence in *why* a pick is recommended.

### 5. Re-run Whale Signal Detector for NCAAB

After deploying the name-matching fix, trigger a fresh signal detection pass so tonight's NCAAB picks get properly scored composite values instead of flat defaults.

## Technical Details

### Files Modified

1. **`supabase/functions/bot-generate-daily-parlays/index.ts`**
   - Add `normalizeTeamName()` function with abbreviation map
   - Apply normalization when looking up `ncaabStatsMap` in `calculateNcaabTeamCompositeScore`

2. **`src/components/team-bets/TeamBetsDashboard.tsx`**
   - Auto-detect sport: if no upcoming NBA bets exist, default `selectedSport` to "NCAAB"
   - Move NCAAB to second position in sport tabs (after ALL)

3. **`src/components/team-bets/TeamBetPickBanner.tsx`**
   - For totals, show "Over {line}" or "Under {line}" based on `recommended_side`

4. **`src/components/team-bets/TeamBetCard.tsx`**
   - Add optional KenPom context line beneath matchup for NCAAB games

5. **`src/components/team-bets/TeamBetOddsDisplay.tsx`**
   - Show directional label for totals (Over/Under)

