

# Boost Team Moneyline Parlays

## What Won Yesterday

The winning $464 parlay was a 4-leg team moneyline mix: heavy NBA favorites (safe legs) paired with NCAAB plus-money underdogs (high-reward legs). This asymmetric structure -- low-risk anchors multiplied by high-upside shots -- is the key pattern to replicate.

## Changes

### 1. Boost ML category weights in the database

| Category | Side | Current Weight | New Weight | Reasoning |
|---|---|---|---|---|
| ML_FAVORITE | away | 0.98 | **1.25** | Yesterday's winner relied on favorites |
| ML_FAVORITE | home | 1.00 | **1.25** | Equal treatment for home favorites |
| ML_UNDERDOG | away | 0.96 | **1.15** | Underdogs provided the payout multiplier |
| ML_UNDERDOG | home | 1.00 | **1.15** | Equal treatment for home underdogs |

### 2. Add more team ML parlay profiles

Currently: 2 profiles generating 3-leg ML parlays + 1 mixed 4-leg profile (out of 50 total exploration profiles).

New allocation -- replace some underperforming spread profiles (SHARP_SPREAD/away is blocked at 0-6 anyway):

| Remove | Add |
|---|---|
| 2x `team_spreads` (3-leg) | 2x `team_ml` (3-leg) -- more pure ML parlays |
| 1x `team_mixed` (4-leg spread+total) | 1x `team_ml` (4-leg) -- bigger ML parlays |
| -- | 2x `team_ml_cross` (3-leg) -- NBA + NCAAB ML mix |

This takes team ML profiles from **2 to 7** (plus 2 cross-sport ML), giving roughly 5x more moneyline parlay generation while keeping the 50-profile total unchanged.

### 3. Add a cross-sport ML strategy

Create a `team_ml_cross` strategy that specifically mixes NBA moneylines with NCAAB moneylines -- replicating the exact structure of yesterday's winner.

## Technical Details

### Database updates (4 UPDATE statements on `bot_category_weights`)
- Update ML_FAVORITE/away weight to 1.25
- Update ML_FAVORITE/home weight to 1.25
- Update ML_UNDERDOG/away weight to 1.15
- Update ML_UNDERDOG/home weight to 1.15

### Generator profile changes in `bot-generate-daily-parlays/index.ts`

Replace in the exploration profiles array:
- Lines 87-88: Change 2x `team_spreads` to 2x `team_ml` (3-leg)
- Line 91: Change 1x `team_mixed` (4-leg spread+total) to `team_ml` (4-leg moneyline only)
- Lines 93: Change `team_mixed` (spread+total+moneyline) to `team_ml_cross` with sports `['basketball_nba', 'basketball_ncaab']`
- Line 96: Change `team_all` to `team_ml_cross` with sports `['basketball_nba', 'basketball_ncaab']`

Final team ML profile count: **4 pure team_ml + 2 team_ml_cross + 2 team_mixed remaining = 8 team-focused profiles** (up from 3 ML-capable).

### Generator strategy logic

Add handling for the new `team_ml_cross` strategy that:
- Filters team picks to moneyline only
- Requires at least one leg from each sport (NBA + NCAAB)
- Prioritizes the favorite+underdog mix pattern (1-2 safe favorites + 1-2 plus-money underdogs)

### Trigger regeneration

After deploying the updated function and weights, call `bot-generate-daily-parlays` with `forceRegenerate: true` to generate new parlays with the boosted ML allocation for today's slate.

