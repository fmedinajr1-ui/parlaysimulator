

# Fix Lottery Scanner: Force-Regenerate with Date Filter

## Problem
The 3 existing lottery tickets were generated BEFORE the date filter fix was deployed. The standard ticket still includes **OG Anunoby (Knicks @ Raptors)** -- the Knicks aren't playing today. The scanner currently skips when it sees 3 tickets already exist (`existingLotteryParlays.length >= 3`).

## Verified: Sweet Spots ARE Being Used
The daily parlays do include sweet spot engine picks:
- `sweet_spot_core` (3-leg) -- multiple parlays
- `sweet_spot_plus` (4-leg) -- multiple parlays
- Other profiles (`force_mispriced_conviction`, `cross_sport`, `grind_stack`) use different engines but that's expected

## Fix: Add `force` Parameter to Lottery Scanner

### Change 1: Add force mode to void + regenerate (lines 163-166)

In `supabase/functions/nba-mega-parlay-scanner/index.ts`, after parsing the request body, add handling for `body.force === true`:

- When `force` is true, UPDATE all existing lottery tickets for today to `outcome: 'void'` with a `lesson_learned` note
- Log how many were voided
- This allows the scanner to proceed past the "already have 3" check since voided tickets are excluded (`neq('outcome', 'void')`)

```text
Current (line 163-166):
  const body = await req.json();
  replayMode = body?.replay === true;
  excludePlayers = ...;

New:
  const body = await req.json();
  replayMode = body?.replay === true;
  excludePlayers = ...;
  if (body?.force === true) {
    void existing mega_lottery_scanner tickets for today
    log count voided
  }
```

### Change 2: Deploy and invoke

After deploying:
- Call `nba-mega-parlay-scanner` with `{ "force": true }`
- The date filter fix (already deployed) will exclude non-today games
- New tickets will only include players from today's 3 games

## Files Modified
- `supabase/functions/nba-mega-parlay-scanner/index.ts` (lines 163-166)

## Expected Result
- Old tickets with OG Anunoby get voided
- 3 fresh lottery tickets generated using only today's games
- Date filter ensures no future-game players leak in

