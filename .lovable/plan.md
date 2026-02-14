

# Use Alternate Spreads Instead of High Spreads

## Problem
The bot is picking up massive spreads like -16.5, -17.5 in NCAAB (e.g., UCLA -16.5, St. John's -16.5, Loyola -17.5). These are hard to cover and unreliable. Instead of using the main spread line, we should shop for alternate (lower) spreads with adjusted odds -- similar to how the bot already shops for alternate player prop lines.

## Current State
- The `fetch-alternate-lines` edge function only supports **player prop** alternate markets (points, rebounds, assists, etc.)
- The `selectOptimalLine` function only works on player props
- There is **no spread alternate line shopping** -- spread picks always use the main book line
- The Odds API supports `spreads_alternate` as a market key for team alternate spreads

## Changes

### 1. Add Alternate Spread Markets to `fetch-alternate-lines`
Add team-level alternate spread market keys to the `ALTERNATE_MARKETS` map so the function can fetch alternate spreads from The Odds API.

**File:** `supabase/functions/fetch-alternate-lines/index.ts`
- Add `spreads: 'spreads_alternate'` (or the correct Odds API key for alternate team spreads)
- Update the player matching logic to also support team-based outcomes (spreads use team names, not player names)
- Add a new `teamName` parameter alongside `playerName` to support team-level lookups

### 2. Add a Spread Cap + Alt Spread Shopping in Generation
When a spread pick has `abs(line) >= 10`, instead of using the raw line, shop for an alternate lower spread. For example, if the main line is -16.5, look for -10.5 or -12.5 at adjusted (plus-money) odds.

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

**Spread cap constant:**
```text
MAX_SPREAD_LINE = 10  -- any spread above this triggers alt shopping
```

**In the spread pick building section (~line 1902):**
- After creating the spread pick, check if `abs(line) >= MAX_SPREAD_LINE`
- If so, call `fetch-alternate-lines` with the event ID and team name
- Select the best alternate spread that is closer to -10 but still has reasonable odds (-150 to +200)
- Replace the pick's line and odds with the alternate values
- Tag the pick with `original_line` and `selected_line` for tracking (same pattern as player prop alt lines)

**Selection logic for alt spreads:**
- Target range: abs(line) between 7 and MAX_SPREAD_LINE
- Prefer the spread closest to -10 with the best odds
- Safety floor: don't go below abs(7) as that loses the edge entirely
- If no viable alternate found, **skip the pick entirely** rather than using the high spread

### 3. Hard Block on Spreads > MAX_SPREAD_LINE Without Alts
If a spread is above the cap and no alternate line is found, block it from the pool entirely. This prevents any parlay from containing a -15.5 or -17.5 spread.

**In the team pick filter (~line 2289):**
- Add a filter: if `bet_type === 'spread'` and `abs(line) >= MAX_SPREAD_LINE` and no alt line was applied, exclude the pick

## Expected Impact
- No more -15, -16, -17 point spreads in parlays
- High-spread games get converted to alt spreads around -10 to -12 with plus-money odds
- Better hit rates on spread legs since covering 10 points is far more likely than covering 17
- Tracked via `original_line` vs `selected_line` for performance analysis

