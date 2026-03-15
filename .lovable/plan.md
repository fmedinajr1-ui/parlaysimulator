

# StatMuse Quarter Stats Scraper — Progress & Next Steps

## What's Done

Successfully scraped **57 out of 89** NBA players on today's slate. Real quarter-by-quarter data (Q1-Q4 averages for PTS, REB, AST, STL, BLK, 3PM) is now stored in `player_quarter_baselines` with `data_source = 'statmuse'`.

Key players completed include: Anthony Edwards, Giannis Antetokounmpo, Shai Gilgeous-Alexander, Donovan Mitchell, Karl-Anthony Towns, Jalen Brunson, James Harden, Cade Cunningham, Scottie Barnes, Cooper Flagg, and many more.

## What's Remaining

~32 role players still need scraping (Brice Sensabaugh, Dean Wade, Jaylon Tyson, Max Christie, etc.). The scraper works — it just needs to be invoked one player at a time due to Firecrawl latency (~20s per player × 4 quarters).

## Plan to Finish

1. **Continue invoking the scraper** for the remaining ~32 players in parallel batches of 5 (one player per call). This will take roughly 3-4 more rounds of invocations.

2. **Fix the orchestrator timeout issue**: The `refresh-l10-and-rebuild` pipeline currently batches 10 players per call, which times out. Update it to batch **2 players max** per invocation, or better yet, have each invocation process just 1 player. This ensures the daily automated run completes without timeouts.

3. **War Room cards will automatically show real data** — the `get-player-quarter-profile` function already prioritizes StatMuse baselines over tier estimates. No UI changes needed.

## One Issue Found

- **P.J. Washington** returned `insufficient_quarters (1/4)` — StatMuse may format his name differently or the page structure varies. Worth investigating the URL slug.

