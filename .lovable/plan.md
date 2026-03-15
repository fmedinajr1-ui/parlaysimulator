

# Pre-Generation Lineup Refresh + FanDuel Odds Verification

## Problem

1. **Injury data stale at generation time**: The lineup scraper runs on its own schedule. When parlays are generated, `lineup_alerts` may not have the latest OUT/DOUBTFUL statuses (e.g., TJ McConnell, Tyrese Maxey). The injury blocklist (`fetchInjuryBlocklist`) only filters what's already in the table.

2. **FanDuel odds not explicitly verified**: `unified_props` is queried without a bookmaker filter. While the whale-odds-scraper prioritizes FanDuel, there's no guarantee every prop in the pool has FanDuel-sourced odds — some may be from DraftKings or consensus lines.

## Changes

### 1. Trigger Lineup Scraper Before Parlay Generation

**In `supabase/functions/refresh-l10-and-rebuild/index.ts`**:
- Add a new Step 0 (before syncing game logs): call `firecrawl-lineup-scraper` to refresh injury/lineup data
- This ensures `lineup_alerts` has the freshest OUT/DOUBTFUL statuses before the generation pipeline uses them
- Add a 5-second delay after the scraper returns to allow the data to propagate

### 2. Add FanDuel Bookmaker Preference to Pick Pool

**In `supabase/functions/bot-generate-daily-parlays/index.ts`** (in `buildPropPool`):
- When querying `unified_props` (line ~4401), add `.eq('bookmaker_key', 'fanduel')` as the primary query
- Fall back to all bookmakers only if FanDuel returns fewer than 20 props (thin coverage)
- Log how many props are FanDuel-sourced vs. fallback so we can track coverage
- When enriching sweet spots with odds from the `oddsMap`, tag each pick with `odds_source: 'fanduel' | 'other'` for transparency

### 3. Log Injury Blocklist Freshness

**In `bot-generate-daily-parlays/index.ts`** (in `fetchInjuryBlocklist`):
- Log the most recent `updated_at` from `lineup_alerts` so we can see if data is stale
- If the most recent alert is older than 3 hours, log a warning

## What This Fixes

- TJ McConnell/Tyrese Maxey (and any newly ruled-out players) will be caught before parlays are built, not after via the pre-game verifier
- Every prop in the pool will prioritize FanDuel lines, ensuring the odds we're building parlays on match what you'd actually bet on FanDuel
- No more relying on post-generation cleanup (pre-game-leg-verifier) as the primary injury gate — that becomes a safety net, not the first line of defense

