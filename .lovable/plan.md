

## Switch PrizePicks Scraper from Firecrawl to Direct API

### Problem

Firecrawl is returning placeholder/hallucinated data from the PrizePicks SPA because the page content is dynamically rendered and protected. Meanwhile, PrizePicks has a public-facing API at `https://api.prizepicks.com/projections` that returns structured JSON directly -- no scraping needed.

### Solution

Replace the Firecrawl-based scraping approach with direct HTTP calls to the PrizePicks API. This API returns projections as structured JSON with player names, stat types, lines, league codes, and more -- exactly what we need.

### How the PrizePicks API Works

The projections endpoint returns a JSON:API formatted response with two key sections:
- `data[]` -- array of projection objects with `stat_type`, `line_score`, `board_time`, etc.
- `included[]` -- array of related objects (players, leagues, games) referenced by ID

Each projection in `data` has a relationship to a player in `included`, which contains the player name, team, position, and league.

### Changes

**File: `supabase/functions/pp-props-scraper/index.ts`**

1. **Remove Firecrawl dependency entirely** -- no more `FIRECRAWL_API_KEY` check, no scroll actions, no JSON extraction schema
2. **Add direct API fetch** to `https://api.prizepicks.com/projections` with appropriate headers:
   - `Accept: application/json`
   - Standard browser `User-Agent` header
   - Query params: `?league_id=X` or `?single_stat=true` to filter by sport
3. **Parse the JSON:API response**:
   - Build a lookup map from `included[]` for players (type: "new_player") and leagues
   - For each projection in `data[]`, resolve the player name, team, position, league from the included map
   - Map to `ExtractedProjection` format and feed into the existing `processExtractedProjections` pipeline
4. **Add league ID mapping** for the API query parameter:
   - MLB/MLBST, NBA, NHL, etc. each have numeric league IDs on PrizePicks
   - If we don't know the IDs, fetch all projections and filter client-side by league name
5. **Keep the existing `processExtractedProjections` function** unchanged -- it already handles MLBST mapping, stat normalization, and sport filtering
6. **Remove the synthetic/fallback data path** that creates fake props from `unified_props`

### Technical Details

```text
Current flow:
  Firecrawl scrape -> LLM JSON extraction -> placeholder data -> failure

New flow:
  fetch("https://api.prizepicks.com/projections") -> parse JSON:API -> real data -> success
```

The core parsing logic will look like:

```typescript
// Fetch projections from PrizePicks API
const response = await fetch('https://api.prizepicks.com/projections?single_stat=true&per_page=250', {
  headers: {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 ...',
    'X-Device-ID': crypto.randomUUID(),
  },
});
const apiData = await response.json();

// Build lookup maps from included resources
const playerMap = new Map();  // id -> { name, team, position }
const leagueMap = new Map();  // id -> { name }
for (const item of apiData.included || []) {
  if (item.type === 'new_player') {
    playerMap.set(item.id, {
      name: item.attributes.display_name || item.attributes.name,
      team: item.attributes.team,
      position: item.attributes.position,
    });
  }
  if (item.type === 'league') {
    leagueMap.set(item.id, item.attributes.name);
  }
}

// Convert each projection to our format
const projections = [];
for (const proj of apiData.data || []) {
  const attrs = proj.attributes;
  const playerId = proj.relationships?.new_player?.data?.id;
  const player = playerMap.get(playerId);
  if (!player) continue;
  
  const leagueId = proj.relationships?.league?.data?.id;
  const league = leagueMap.get(leagueId) || '';
  
  projections.push({
    player_name: player.name,
    team: player.team,
    stat_type: attrs.stat_type,     // e.g., "Strikeouts", "Points"
    line: parseFloat(attrs.line_score),
    league: league,                  // e.g., "MLBST", "NBA"
    game_time: attrs.start_time,
  });
}
```

Then feed `projections` into the existing `processExtractedProjections(projections, sports)` which handles all the stat mapping, MLBST detection, and database insertion.

### Cloudflare Considerations

Some sources mention PrizePicks added Cloudflare protection. If the direct API call is blocked:
- Add retry logic with exponential backoff
- Rotate User-Agent strings
- Fall back to Firecrawl as a secondary approach if the API returns 403

### Files Changed

| Action | File |
|--------|------|
| Modify | `supabase/functions/pp-props-scraper/index.ts` |

