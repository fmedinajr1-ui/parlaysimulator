

# Fix Telegram Display: Correct Counts, Spread Formatting, and Visual Polish

## Problem Summary
Three issues visible in the screenshots:

1. **"Generated: 0 parlays"** -- When generation is re-triggered and no NEW parlays are created, the notification shows 0 instead of counting existing parlays for the day
2. **Spread legs show "AWAY 1.5 SPREAD"** -- The leg data has no `type: 'team'` field and no `home_team`/`away_team` fields. The matchup is packed into `player_name` (e.g., "SE Louisiana Lions @ East Texas A&M Lions") with `prop_type: 'spread'` and `side: 'away'`. The formatter doesn't handle this case.
3. **Display looks bland** -- Headers and pick lines need more visual icons

## Data Structure (from actual DB)
Spread/total legs look like this -- no `type`, no `home_team`, no `away_team`:
```json
{
  "player_name": "SE Louisiana Lions @ East Texas A&M Lions",
  "prop_type": "spread",
  "side": "away",
  "line": 1.5,
  "category": "SPREAD",
  "american_odds": -110
}
```

## Changes

### 1. Fix Generation Count (`bot-send-telegram/index.ts`)

In `formatTieredParlaysGenerated()` (line ~100-153):
- After building the message with the passed-in counts, add a DB lookup to count actual parlays for today if `totalCount` is 0
- If existing parlays exist, change the message to show "X parlays active" instead of "Generated: 0 parlays"
- This ensures re-triggers show the correct state

### 2. Fix Spread/Total Detection in `formatLegDisplay()` (`telegram-webhook/index.ts`)

In `formatLegDisplay()` (line ~767-863):
- Before the existing `if (leg.type === 'team')` check, add detection for legs where `category` is SPREAD/TOTAL/MONEYLINE or `prop_type` is spread/total/h2h but `type` is not set
- Parse team names from `player_name` using the " @ " delimiter (e.g., "SE Louisiana Lions @ East Texas A&M Lions" splits into away="SE Louisiana Lions", home="East Texas A&M Lions")
- For spreads: resolve the correct team using `side` (home/away) and format as "Take [Team] [+/-line] (odds)"
- For totals: format as "Take OVER/UNDER [line] (odds)"
- Set `matchupLine` to "[Away] @ [Home]"

### 3. Add Visual Icons to Headers and Picks (`telegram-webhook/index.ts`)

**Tier headers** (line ~557-566):
- Add more decorative icons per tier:
  - Exploration: `🔬 Exploration` (already has this)
  - Validation: `✅ Validation` (keep)
  - Execution: `💰 Execution` (keep)

**Pick lines** (in `formatLegDisplay`):
- Add bet-type icons before the action text:
  - Spread picks: `📊` prefix
  - Total picks: `📈` prefix  
  - Moneyline picks: `💎` prefix
  - Player props: `🏀` (or sport-specific icon)

**Parlay header line** (line ~581):
- Add a tier-specific icon to each parlay entry number
- Format: `  1. 🎲 (3-leg) +450 PENDING` (instead of plain `1. (3-leg) +450`)

**Main header** (line ~568):
- Make more visually impactful: `🎯🔥 TODAY'S PARLAYS 🔥🎯` with decorative divider

### 4. Also Fix in `bot-send-telegram/index.ts` Top Picks Preview

The top picks preview (line ~116-148) in `formatTieredParlaysGenerated` has the same spread issue since team legs coming from the generation engine may also lack `type: 'team'`. Add the same `player_name` "@" parsing logic there.

## Files Modified
- `supabase/functions/telegram-webhook/index.ts` -- formatLegDisplay + handleParlays header
- `supabase/functions/bot-send-telegram/index.ts` -- formatTieredParlaysGenerated count fix + top picks fix

## Expected Output After Fix

Generation notification:
```
📊 TIERED PARLAY GENERATION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 29 parlays active for Feb 16

🔬 Exploration: 28 parlays
✅ Validation: 1 parlays
🎯 Execution: 0 parlays

📍 Pool Size: 29 picks

🔥 Top Picks Preview:
📊 Take SE Louisiana Lions -1.5 (-110)
📈 Take UNDER 135.5 (-110)
...
```

/parlays command:
```
🎯🔥 TODAY'S PARLAYS 🔥🎯
━━━━━━━━━━━━━━━━━━━━━━━━

💰 Execution (0) — Kelly stakes

🔬 Exploration (28) — $0 stake

  1. 🎲 (1-leg) -110 ⏳
     📊 Take SE Louisiana Lions +1.5 (-110)
     SE Louisiana Lions @ East Texas A&M Lions | NCAAB
     🎯70 | 💎65%

  2. 🎲 (1-leg) -110 ⏳
     📈 Take UNDER 135.5 (-110)
     Louisiana Ragin' Cajuns @ Old Dominion Monarchs | NCAAB
     🎯70 | 💎65%
```
