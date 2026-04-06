

# Replace Static Alt Line Buffers with Real FanDuel Alt Lines

## Problem
All alt line recommendations (e.g., "Alt UNDER 20.5") use hardcoded buffers (3.0 for points, 2.0 for rebounds, etc.) subtracted from the current line. These are fake — they don't reflect actual available lines on FanDuel. The `fetch-alternate-lines` edge function already exists and fetches real alternate lines from The Odds API, but it's only used by the parlay generators, not by the prediction alerts or behavior analyzer.

## Solution
Call `fetch-alternate-lines` for every alert that currently shows a static alt line, and display the **real closest alt line** available on FanDuel instead of a buffer-calculated one.

## Changes

### 1. `fanduel-prediction-alerts/index.ts` — Replace static alt line helpers

**Remove**: `ALT_LINE_BUFFERS`, `VOLATILE_EXTRA_BUFFER`, `getAltBuffer()`, `calcAltLine()`, `getAltLineText()` (lines 401-428)

**Add**: `fetchRealAltLine()` async helper that:
- Calls `fetch-alternate-lines` with the player's event ID, name, prop type, and sport
- From the returned lines array, picks the best alt line for the recommended side:
  - For OVER: find the highest line that's **below** the current line (better value for OVER)
  - For UNDER: find the lowest line that's **above** the current line (better value for UNDER)
- Falls back to a simple ±1.5 buffer if no real alt lines are found (API quota, missing market, etc.)
- Caches results per event+player+prop to avoid duplicate API calls within the same scan

**Update all call sites** (velocity/cascade alerts ~line 921, Take It Now ~line 1197, and signal_factors metadata ~lines 963-964, 1247-1248):
- Replace `getAltLineText(...)` with result from `fetchRealAltLine()`
- Replace `calcAltLine(...)` in metadata with the real alt line value
- Display format: `🎯 Alt Line (FanDuel): OVER 21.5 (-125)` — includes the actual odds

### 2. `fanduel-behavior-analyzer/index.ts` — Replace static alt lines in correlated movement

**Remove**: `getBuffer()`, `calcAltLine()`, `VOLATILITY_EXTRA_BUFFER` buffer logic (wherever defined)

**Add**: Same `fetchRealAltLine()` pattern, but batch it:
- Before building Telegram text for correlated/team news alerts, batch-fetch alt lines for all players in the correlation group
- Replace the inline `→ Alt UNDER 20.5` (currently buffer-calculated at line 1747) with real FanDuel alt line + odds
- Display: `Aaron Gordon: dropping 1 → Alt UNDER 21.5 (-115)`

### 3. Batching and Rate Limiting

To avoid hammering the API (each correlated movement alert can have 4-5 players):
- Batch all alt line fetches at the **end of the scan**, after all signals are identified but before Telegram formatting
- Use `Promise.allSettled()` with a concurrency limit of 3
- Cache results in a `Map<string, { line: number, odds: number }>` keyed by `eventId|playerName|propType`
- If the API returns empty or errors, fall back to displaying "Alt Line: N/A" instead of a fake buffer number

### 4. Telegram Display Format

**Before** (static buffer):
```
Aaron Gordon: rising 1 → Alt UNDER 20.5
🎯 Alt Line Edge: UNDER 20.5
```

**After** (real FanDuel):
```
Aaron Gordon: rising 1 → Alt UNDER 21.5 (-115) [FD]
🎯 Alt Line (FanDuel): UNDER 21.5 (-115)
```

When no real alt line available:
```
🎯 Alt Line: unavailable
```

## Technical Details

- The `fetch-alternate-lines` function uses The Odds API (`THE_ODDS_API_KEY`), which has quota limits
- Each call costs 1 API request — with ~20 alerts per scan and ~4 players per correlation, worst case is ~100 calls
- Caching per scan run prevents duplicates (same player appearing in multiple signal types)
- The prop type mapping in `fetch-alternate-lines` already handles: points, rebounds, assists, threes, PRA, spreads, totals, and combos
- Moneyline props don't have alt lines — skip for those (already no buffer for ML)

## Scope
- 2 edge functions modified (`fanduel-prediction-alerts`, `fanduel-behavior-analyzer`)
- No migrations needed
- No new tables
- Uses existing `fetch-alternate-lines` function unchanged

