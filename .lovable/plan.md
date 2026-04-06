

# Fix Snapback Direction for Pitcher Strikeouts

## Problem
Brandon Woodruff's K line moved from 5.5 → 6.5 (UP). The snapback logic says "UNDER" because it treats every upward drift as an overreaction that will revert. For pitcher strikeouts, this is wrong — a rising K line usually reflects real matchup intel (e.g., facing a high-strikeout team). The market is telling you the pitcher will K more, so the correct action is OVER.

## Root Cause
Line 966 in `fanduel-prediction-alerts`: `snapDirection = drift > 0 ? "UNDER" : "OVER"` applies blanket regression logic to all prop types including pitcher Ks.

The cross-reference gate checks L10/L3 averages but can still pass if the pitcher's stats don't hit the hard-block thresholds (e.g., Woodruff averages enough Ks that UNDER doesn't get blocked).

## Fix

### File 1: `supabase/functions/fanduel-prediction-alerts/index.ts`

**A. Flip snapback direction for pitcher props (~line 966)**

After calculating `drift` and `snapDirection`, add a pitcher-specific override:
- If `prop_type` starts with `pitcher_` and line moved UP → direction = OVER (follow the market)
- If `prop_type` starts with `pitcher_` and line moved DOWN → direction = UNDER (follow the market)
- This makes pitcher props follow market movement rather than fade it, because pitcher K lines move based on matchup data (opponent team K rate, lineup changes)

**B. Update reason text for pitcher props (~line 993-995)**

Change the reason from "Line inflated above open — expect snapback down" to market-following language:
- Rising: "K line rising — matchup/sharp money favors OVER"
- Dropping: "K line dropping — matchup/sharp money favors UNDER"

### File 2: `supabase/functions/fanduel-behavior-analyzer/index.ts`

**Same fix for snapback signals on pitcher props:**
- Find where snapback `actionSide` is set for pitcher props and flip to market-following direction
- Update Telegram text to reflect market-following reasoning for pitcher Ks

## What Stays The Same
- Snapback regression logic for NBA player props (points, rebounds, assists) — those are legitimately inflated by books to trap public OVER bettors
- Team market snapback logic — unchanged
- All other gates (cross-reference, volatility, accuracy) — unchanged

## Scope
- 2 edge function files
- No migration needed
- Pitcher-specific directional override only

