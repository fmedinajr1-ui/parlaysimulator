

# Why Ceiling Shot Can't Find Alt Lines — Root Cause Analysis

## Three Cascading Problems

### Problem 1: Alt lines are only fetched for top 15 picks by composite score
The alt line fetch (line 4719-4728) filters to:
- Must have `event_id` (Bane has none — `actual_line` is null, meaning no Odds API event match)
- Must be NBA
- Must have projection buffer >= `getMinBuffer()` (Bane threes: projected 3.6, line 0.5, buffer 3.1 — this passes)
- Sorted by composite score, top 15 only

**Bane has no `event_id`**, so he's filtered out immediately. Most L10 ceiling candidates have `actual_line: null` which means they were never matched to an Odds API event, so they have no `event_id` either.

### Problem 2: `recommended_line` values are PrizePicks lines (0.5, 2.5, 6.5)
The `recommended_line` for Bane threes is **0.5** — this is a PrizePicks goblin line. Hard Rock has him at lines up to 7. The ceiling gate compares `l10_max (8) >= recommended_line (0.5) * 1.3` which trivially passes, but the alt line search would look for lines between 1.5 and 8 — lines that don't exist in the system because no Odds API event was matched.

### Problem 3: No separate alt line fetch for ceiling candidates
The ceiling_shot strategy relies on `pick.alternateLines` being populated, but the alt line fetch loop only targets the top 15 composite-score picks with `event_id`. There's no separate pass to fetch alt lines specifically for ceiling candidates.

## Fix Plan

### 1. Add a dedicated alt line fetch pass for ceiling_shot candidates
After the existing top-15 alt line fetch, add a second pass that:
- Filters `enrichedSweetSpots` to picks with `l10_max != null` and `l10_max >= compareLine * 1.3`
- For picks missing `event_id`, resolve it from the events list (or `unified_props` event_id lookup)
- Fetches alt lines for up to 15 ceiling candidates that don't already have `alternateLines`

### 2. Resolve event_id for ceiling candidates missing it
Before fetching alt lines, query the Odds API events endpoint or `unified_props` table for event IDs matching the player's team/game. Add a helper that maps player → team → today's event_id.

### 3. Use sportsbook lines instead of PrizePicks lines for ceiling comparison
When evaluating ceiling gates, prefer `actual_line` over `recommended_line`. If `actual_line` is null, attempt to look up the line from `unified_props` (which has sportsbook odds) before falling back to `recommended_line`.

### Files Changed
1. **`supabase/functions/bot-generate-daily-parlays/index.ts`**:
   - After line ~4768: Add ceiling-specific alt line fetch pass with event_id resolution
   - Around line 6917: Update `compareLine` to also check `unified_props` line before falling back to `recommended_line`
   - Add helper function to resolve event_id from unified_props or events for players without one

