

# Fix Take It Now Direction: Follow Market for Non-NBA Props

## Problem
Vince Dunn shots on goal line moved 2.5 → 1.5 (DOWN). The bot says "TAKE OVER" because the snapback regression logic treats ALL non-pitcher props the same: line drops = expect it to bounce back up (OVER). This regression model only makes sense for **NBA player props** where books inflate lines to trap public OVER bettors. For NHL, MLB position players, and other sports, a dropping line means the market expects LESS — the bot should follow that direction and say UNDER.

## Root Cause
Lines 978-982 in `fanduel-prediction-alerts/index.ts`:
```typescript
const isPitcherProp = last.prop_type?.startsWith("pitcher_");
const snapDirection = isPitcherProp
  ? (drift > 0 ? "OVER" : "UNDER")   // Pitcher: follow market
  : (drift > 0 ? "UNDER" : "OVER");  // Others: regression ← WRONG for non-NBA
```

The regression (contrarian) logic should ONLY apply to NBA player props. Everything else should follow the market direction like pitcher props already do.

## Fix

### File: `supabase/functions/fanduel-prediction-alerts/index.ts`

**Replace the direction logic (~lines 978-982) with sport-aware rules:**

```
NBA player props → regression (keep existing: drift up = UNDER, drift down = OVER)
Everything else (NHL, MLB, NCAAB, team markets, pitcher props) → follow market (drift up = OVER, drift down = UNDER)
```

Specifically:
- Add a check: `const useRegression = last.sport === "NBA" && isPlayerPropType(last.prop_type) && !isPitcherProp`
- If `useRegression` → keep current contrarian logic (drift > 0 = UNDER)
- Otherwise → follow market direction (drift > 0 = OVER, drift < 0 = UNDER)

**Update the reason text (~lines 1009-1015):**
- Regression reason: "Line inflated above open — expect snapback down" (NBA only)
- Market-following reason: "Line moving {direction} — market signals {OVER/UNDER}" (NHL, MLB, etc.)

**Update the Telegram action line (~line 1043) and signal label:**
- For market-following signals, change the drift text from "historically snaps back" to "market conviction signal"

## Also update `bot_owner_rules`
Add a new seed rule `non_nba_follow_market` to codify: "Non-NBA props follow market direction, not regression" — so the self-audit engine enforces this going forward.

## Scope
- 1 edge function modified (`fanduel-prediction-alerts`)
- 1 rule insert (migration)
- No structural changes

