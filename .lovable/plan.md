

## NBA Mega Parlay Scanner -- High Odds Only (+100 and Up)

### Overview

Create a new edge function that scrapes all NBA player props from FanDuel and Hard Rock Bet for today's 3 games, filters for only props with American odds of +100 or higher, then cross-references against our full engine stack to find the most accurate high-payout picks and build a parlay.

### What Gets Built

**New file:** `supabase/functions/nba-mega-parlay-scanner/index.ts`

### How It Works

1. **Fetch all NBA props** from The Odds API filtered to `fanduel,hardrockbet` across 7 markets (points, rebounds, assists, threes, blocks, steals, PRA combos)

2. **Filter: Only +100 and above odds** -- discard any prop leg where both over and under prices are below +100. Keep only the side (over or under) that is +100 or higher.

3. **Cross-reference each qualifying prop** against our database:
   - `nba_player_game_logs` -- L5/L10/L20 averages and medians to validate the line
   - `mispriced_lines` -- check if our engine flagged it as mispriced and the edge %
   - `category_sweet_spots` -- L10 hit rate and recommended side
   - `high_conviction_results` -- how many engines agree on this pick
   - `nba_opponent_defense_stats` -- opponent defensive rank for this stat category

4. **Score each prop** with composite formula:
   - Hit rate (40%): L10 hit rate from sweet spots
   - Edge (25%): Mispriced edge percentage
   - Median validation (15%): Gap between player median and the line
   - Conviction (10%): Number of engines agreeing
   - Odds value (10%): Higher American odds score higher

5. **Build optimal 3-5 leg parlays** with constraints:
   - Every leg must be +100 or higher American odds
   - Individual leg hit rate must be 55%+
   - No more than 2 legs from the same game
   - Role-stat alignment (no guards on rebounds, etc.)
   - Maximize combined payout

6. **Return results** with per-leg breakdown: player, prop, side, odds, hit rate, edge, median vs line, and total parlay payout on a $25 bet

### After Creation

The function will be invoked immediately for today's date. Results displayed directly -- no frontend changes needed.

### Technical Details

**API call:**
```text
GET /v4/sports/basketball_nba/odds
  ?apiKey=KEY&regions=us
  &markets=player_points,player_rebounds,player_assists,player_threes,
           player_blocks,player_steals,player_points_rebounds_assists
  &oddsFormat=american
  &bookmakers=fanduel,hardrockbet
```

**Odds filter logic:**
```text
// Keep only sides with +100 or higher
if (over_price >= 100) keep "Over" side
if (under_price >= 100) keep "Under" side
// Discard prop entirely if neither side qualifies
```

**Pipeline:**
```text
All Props (FanDuel + Hard Rock)
  --> Filter: odds >= +100 only
  --> Enrich: game logs, mispriced edges, sweet spots, defense stats
  --> Score: composite formula
  --> Validate: 55%+ hit rate, archetype alignment, minutes threshold
  --> Build: greedy parlay maximizing combined odds
  --> Output: best parlay with full analytics + payout estimate
```

