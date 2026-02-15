

# Fix ML_FAVORITE/ML_UNDERDOG Category Mapping

## What's Wrong

The function `mapTeamBetToCategory` on line 1101-1108 blindly maps:
- **home moneyline = ML_FAVORITE**
- **away moneyline = ML_UNDERDOG**

This is wrong. In NCAAB especially, road teams are frequently the favorite. The bot has been labeling home underdogs as "favorites" and tracking/weighting them incorrectly, leading to a 5.3% hit rate on NCAAB ML_FAVORITE.

## The Fix (2 Changes)

### Change 1: Odds-Based Category Mapping

Replace the static `mapTeamBetToCategory` function so moneyline categories use actual odds:

- **Negative odds (e.g., -150)** = ML_FAVORITE (the actual favorite)
- **Positive odds (e.g., +130)** = ML_UNDERDOG (the actual underdog)
- **Even or missing odds** = fall back to ML_FAVORITE for home, ML_UNDERDOG for away

Update all 4 call sites (lines 2395, 2409, and any others) to pass the `odds` value into the function.

### Change 2: Auto-Block All NCAAB ML_FAVORITE

Add a hard block in the ML Sniper Gate (around line 2481) that rejects ALL NCAAB moneyline favorites outright. The current gate restricts to Top 50 KenPom and odds ranges, but the 5.3% hit rate (1W-12L-6P) shows NCAAB ML favorites simply don't work for the bot regardless of rank or odds.

The block applies after the odds-based category fix, so it will correctly target the actual favorite (negative odds side), not just the home team.

## Technical Details

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

**1. Update `mapTeamBetToCategory` (lines 1101-1108)**

Add an `odds` parameter. For moneyline bets:
- `odds < 0` returns `ML_FAVORITE`
- `odds > 0` returns `ML_UNDERDOG`
- `odds === 0` or undefined falls back to home=FAVORITE, away=UNDERDOG

Spread and total mappings stay the same.

**2. Update call sites (lines 2395, 2409)**

Pass `game.home_odds` / `game.away_odds` to `mapTeamBetToCategory` so the function can determine the true favorite.

**3. Add NCAAB ML_FAVORITE hard block (line ~2481)**

Replace the existing NCAAB ML gate (KenPom + odds range filtering) with a complete block:

```
if (isNCAAB && pick.odds < 0) {
  mlBlocked.push(`NCAAB ML_FAVORITE blocked (5% historical hit rate)`);
  return false;
}
```

NCAAB ML_UNDERDOG (positive odds, actual underdogs) remains allowed if it passes the existing KenPom and composite gates.

### Expected Impact
- Correct category tracking means calibration weights will reflect true favorite/underdog performance
- Eliminating NCAAB ML favorites removes the biggest single source of losses (12 losses from 1 category)
- NBA ML logic is already restricted to home favorites with negative odds, so the odds-based mapping aligns with existing behavior there
