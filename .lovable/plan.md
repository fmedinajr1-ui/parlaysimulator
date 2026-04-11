

# Get PrizePicks Tennis Props via Firecrawl (Cloudflare Bypass)

## Problem
- PrizePicks API returns 403 from all edge function requests (Cloudflare blocks server-side calls)
- The Odds API doesn't carry today's tennis matches — only 1 Monte Carlo event with 0 today
- PrizePicks props (total games, games won, sets, fantasy scores) are proprietary projections not available elsewhere

## Solution: Use Firecrawl to Scrape PrizePicks

You already have a `FIRECRAWL_API_KEY` configured. Firecrawl is a web scraping service that handles Cloudflare challenges and JavaScript rendering — exactly what's needed to bypass the 403 block.

### Approach

Rewrite the PrizePicks fetch logic in `pp-props-scraper` to use Firecrawl instead of direct API calls:

1. **Firecrawl scrape** of `https://api.prizepicks.com/projections?single_stat=true&per_page=250` — Firecrawl renders the page through a real browser environment, bypassing Cloudflare
2. If Firecrawl returns the JSON response, parse it with the existing `parsePrizePicksResponse()` logic (already handles the JSON:API format perfectly)
3. Filter for tennis sports (ATP, WTA) and map to `unified_props` with proper prop types: `total_games`, `games_won`, `total_sets`, `fantasy_score`
4. Keep direct API fetch as a fallback (in case Cloudflare ever loosens restrictions)

### Pipeline Integration

After scraping, the existing flow works:
- `pp-props-scraper` writes tennis props → `pp_snapshot` + `unified_props`
- `tennis-games-analyzer` reads `unified_props` → cross-references `tennis_player_stats` → writes picks

### Files

| File | Action |
|------|--------|
| `supabase/functions/pp-props-scraper/index.ts` | **Edit** — add Firecrawl as primary fetch method, keep direct API as fallback |
| `supabase/functions/tennis-props-sync/index.ts` | **Edit** — also sync `pp_snapshot` tennis rows into `unified_props` (bridge PP data to the analyzer) |

### What Changes in pp-props-scraper

- Primary path: `POST https://api.firecrawl.dev/v1/scrape` with the PrizePicks API URL
- Firecrawl returns rendered page content; extract JSON from the response
- Existing `parsePrizePicksResponse()` and `processExtractedProjections()` stay unchanged
- Fallback: try direct API fetch (current logic) if Firecrawl fails

### What Changes in tennis-props-sync

- Add a new source: query `pp_snapshot` for today's ATP/WTA props
- Map PP stat types (`Total Games`, `Games Won`, `Sets`, `Fantasy Score`) into `unified_props` format
- This bridges PrizePicks data into the analyzer pipeline

