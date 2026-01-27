

# Fix PP Scraper with Firecrawl JSON Extraction

## Problem

The current `pp-props-scraper` uses regex parsing on raw markdown/HTML content, which fails because:
1. PrizePicks is a React SPA with dynamically loaded content
2. Regex patterns like `/([A-Z][a-z]+ [A-Z][a-z]+)/g` are too simplistic for real player names
3. The fallback to `unified_props` creates "synthetic" data that doesn't represent actual PP lines

**Result:** The scraper always falls back to fake data, defeating the purpose of the Whale Proxy.

---

## Solution: Firecrawl LLM-Extract

Use Firecrawl's `json` format with a schema to let AI extract structured projection data directly from the rendered page.

---

## Implementation

### File: `supabase/functions/pp-props-scraper/index.ts`

**Replace the Firecrawl request (lines 127-140)** with JSON extraction:

```typescript
const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${firecrawlKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: ppBoardUrl,
    formats: [
      {
        type: 'json',
        schema: {
          type: 'object',
          properties: {
            projections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  player_name: { type: 'string', description: 'Full name of the player' },
                  team: { type: 'string', description: 'Team abbreviation (e.g., LAL, BOS)' },
                  opponent: { type: 'string', description: 'Opponent team abbreviation' },
                  stat_type: { type: 'string', description: 'Type of stat (Points, Rebounds, Assists, etc.)' },
                  line: { type: 'number', description: 'The projection line value' },
                  league: { type: 'string', description: 'League name (NBA, NHL, WNBA, etc.)' },
                  game_time: { type: 'string', description: 'Game start time if visible' }
                },
                required: ['player_name', 'stat_type', 'line']
              }
            }
          },
          required: ['projections']
        },
        prompt: 'Extract all player prop projections visible on this PrizePicks board. For each projection, get the player name, their team, the stat type (Points, Rebounds, Assists, etc.), and the line value (the number like 25.5). Also extract the league (NBA, NHL, etc.) and opponent team if visible.'
      }
    ],
    waitFor: 8000,  // Increased wait for SPA to fully load
    onlyMainContent: false,
  }),
});
```

**Replace the response processing (lines 148-165)** to handle JSON extraction:

```typescript
const firecrawlData = await firecrawlResponse.json();
console.log('[PP Scraper] Firecrawl response received');

// Extract the JSON result from Firecrawl's response
const extractedData = firecrawlData.data?.json || firecrawlData.json || null;

if (!extractedData || !extractedData.projections || extractedData.projections.length === 0) {
  console.log('[PP Scraper] No projections extracted from JSON, checking fallback...');
  // Continue to fallback logic...
} else {
  console.log('[PP Scraper] Extracted', extractedData.projections.length, 'projections via JSON');
  
  // Process extracted projections
  const propsToInsert = processExtractedProjections(extractedData.projections, sports);
  // ... continue with insertion
}
```

**Add new processing function** to replace `parseProjectionsFromContent`:

```typescript
function processExtractedProjections(
  projections: Array<{
    player_name: string;
    team?: string;
    opponent?: string;
    stat_type: string;
    line: number;
    league?: string;
    game_time?: string;
  }>,
  targetSports: string[]
): Array<PPSnapshotInsert> {
  const now = new Date().toISOString();
  const props: Array<PPSnapshotInsert> = [];
  
  for (const proj of projections) {
    // Determine sport from league
    const league = proj.league?.toUpperCase() || 'NBA';
    const sport = LEAGUE_TO_SPORT[league] || 'basketball_nba';
    
    // Filter by target sports
    if (!targetSports.some(s => league.includes(s))) continue;
    
    // Normalize stat type
    const normalizedStat = STAT_TYPE_MAP[proj.stat_type] || 
      `player_${proj.stat_type.toLowerCase().replace(/\s+/g, '_')}`;
    
    // Build matchup string
    const matchup = proj.team && proj.opponent 
      ? `${proj.team} vs ${proj.opponent}` 
      : null;
    
    props.push({
      player_name: proj.player_name,
      pp_line: proj.line,
      stat_type: normalizedStat,
      sport: sport,
      start_time: proj.game_time || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      pp_projection_id: `extracted_${Date.now()}_${props.length}`,
      team: proj.team || null,
      position: null,
      captured_at: now,
      previous_line: null,
      market_key: `${sport}_${proj.player_name}_${normalizedStat}`,
      matchup: matchup,
      league: league,
      event_id: `pp_${league}_${proj.player_name}_${Date.now()}`,
      period: 'Game',
      is_active: true,
    });
  }
  
  return props;
}
```

---

## Key Changes Summary

| Aspect | Before (Broken) | After (Fixed) |
|--------|-----------------|---------------|
| **Extraction Method** | Regex on markdown | LLM-powered JSON extraction |
| **Data Source** | Raw HTML/markdown text | Structured AI-parsed objects |
| **Reliability** | ~0% success rate | High success (LLM understands page context) |
| **Schema** | None (pattern matching) | Strict JSON schema with field types |
| **Fallback** | Synthetic data from `unified_props` | Keep as true fallback only |

---

## Expected Firecrawl Response

```json
{
  "success": true,
  "data": {
    "json": {
      "projections": [
        {
          "player_name": "LeBron James",
          "team": "LAL",
          "opponent": "BOS",
          "stat_type": "Points",
          "line": 25.5,
          "league": "NBA",
          "game_time": "7:30 PM ET"
        },
        {
          "player_name": "Stephen Curry",
          "team": "GSW",
          "opponent": "PHX",
          "stat_type": "3-Pointers Made",
          "line": 4.5,
          "league": "NBA"
        }
      ]
    },
    "metadata": {
      "title": "PrizePicks",
      "sourceURL": "https://app.prizepicks.com"
    }
  }
}
```

---

## Technical Notes

1. **waitFor increased to 8000ms**: PrizePicks SPA needs time to hydrate and load projections
2. **Prompt guides the LLM**: Natural language description helps the AI understand what to extract
3. **Schema enforces structure**: Required fields ensure we always get player_name, stat_type, and line
4. **Graceful degradation**: If JSON extraction fails, the existing `unified_props` fallback still works

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/pp-props-scraper/index.ts` | Replace Firecrawl request with JSON format, add `processExtractedProjections()`, remove regex `parseProjectionsFromContent()` |

