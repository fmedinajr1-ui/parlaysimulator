
# Add Role-Player Volatility Flag to Smart Check

## Problem
Sam Hauser had 100% L10 hit rate on 3.5 rebounds but put up 0 in-game. Bench players with low-floor props (rebounds, assists) are inherently volatile — high L10 hit rates mask the risk that they can easily post a zero on any given night.

## Solution
Add a `ROLE_PLAYER_VOLATILE` risk tag that fires when a player has a low line on a high-variance prop despite a strong L10 hit rate. This catches the "looks safe but isn't" trap.

## Detection Logic
A leg gets flagged when ALL of these are true:
- **Low line**: rebounds ≤ 4.5, assists ≤ 4.5, steals ≤ 1.5, blocks ≤ 1.5, threes ≤ 2.5
- **High L10 hit rate**: ≥ 70%
- **Low L10 average (thin margin)**: L10 avg is within 1.5× of the line (e.g., avg 4.2 on a 3.5 line)
- **Side is OVER** (unders on low lines are less volatile)

## Changes

### File: `supabase/functions/bot-parlay-smart-check/index.ts`

1. **Add tag to score map** (~line 23-38):
   - `'ROLE_PLAYER_VOLATILE': -15`

2. **Add volatility check** after the L3 check block (~line 252, before blowout check):
   - Check if prop_type is a low-floor category (rebounds, assists, steals, blocks, threes)
   - Check if line is at or below the volatile threshold for that prop
   - Check if L10 hit rate is high (≥70%) but L10 avg margin over line is thin (< 1.5)
   - If all conditions met and side is 'over': push `ROLE_PLAYER_VOLATILE` tag
   - Set recommendation to `CAUTION` if currently `KEEP`
   - Add detail: `volatile_reason: "Low-floor prop (3.5 reb) with thin margin (avg 4.2) — bench player variance risk"`

### File: `supabase/functions/bot-matchup-defense-scanner/index.ts`

3. **Add same tag in scanner risk tag generation** so the tag also appears in matchup broadcast recommendations, using the same logic against player L10 data already available in the scanner.

### File: `src/components/parlay/ParlaySmartCheckPanel.tsx` (if tag rendering exists)

4. **Render the new tag** with an appropriate icon/color — orange warning badge showing "ROLE PLAYER VOLATILE" with tooltip explaining the risk.

## Tag Behavior
- Score penalty: **-15** (same as BLOWOUT_RISK — meaningful but not a hard DROP)
- Recommendation: escalates to **CAUTION** (doesn't auto-drop, just warns)
- Works alongside existing tags — a volatile player in a blowout game stacks both penalties
