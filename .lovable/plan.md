

# Connect Real PrizePicks Data via Firecrawl Scraper

## Overview

Create a backend system that scrapes PrizePicks props using Firecrawl, compares them against existing sportsbook consensus (FanDuel/DraftKings in `unified_props`), and generates real sharp signals for the Whale Proxy dashboard.

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  PrizePicks Board   │────▶│  pp-props-scraper    │────▶│   pp_snapshot       │
│  (via Firecrawl)    │     │  (Edge Function)     │     │   (Database)        │
└─────────────────────┘     └──────────────────────┘     └─────────────────────┘
                                                                    │
                                                                    ▼
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│    unified_props    │────▶│  whale-signal-       │────▶│   whale_picks       │
│  (FD/DK Book Data)  │     │  detector            │     │   (Sharp Signals)   │
└─────────────────────┘     └──────────────────────┘     └─────────────────────┘
                                                                    │
                                                                    ▼
                                                         ┌─────────────────────┐
                                                         │   useWhaleProxy     │
                                                         │   (Frontend Hook)   │
                                                         └─────────────────────┘
```

---

## Implementation Plan

### Phase 1: PrizePicks Scraper Edge Function

**File**: `supabase/functions/pp-props-scraper/index.ts`

Creates a new edge function that:
1. Uses Firecrawl to scrape `https://api.prizepicks.com/projections` (their internal API returns JSON)
2. Parses the response to extract player props (name, stat type, line, sport)
3. Saves snapshots to `pp_snapshot` table
4. Runs every 5 minutes via the pipeline orchestrator

**Key Data Mapping**:

| PrizePicks Field | pp_snapshot Column |
|-----------------|-------------------|
| `attributes.line_score` | `pp_line` |
| `attributes.stat_type` | `stat_type` |
| `new_player.display_name` | `player_name` |
| `league.name` | `sport` |
| `start_time` | `start_time` |

### Phase 2: Whale Signal Detector Edge Function

**File**: `supabase/functions/whale-signal-detector/index.ts`

Creates signal detection logic that:
1. Reads fresh props from `pp_snapshot` 
2. Matches against book consensus in `unified_props` by player + stat type
3. Calculates SharpScore using the existing algorithm:
   - **Divergence** (0-40 pts): `|pp_line - book_consensus|` normalized
   - **Move Speed** (0-25 pts): Rate of PP line change vs previous snapshot
   - **Confirmation** (0-20 pts): Books moving toward PP line
   - **Board Behavior** (0-15 pts): Props frozen/relisted
4. Generates confidence grades (A: 80+, B: 65-79, C: 55-64)
5. Inserts valid signals into `whale_picks` table
6. Applies deduplication (no re-issue within 15 min unless score increased 15+)

### Phase 3: Frontend Integration

**File**: `src/hooks/useWhaleProxy.ts`

Updates the hook to:
1. Fetch from `whale_picks` table when `isSimulating = false`
2. Subscribe to real-time updates for new picks
3. Keep mock generator active when `isSimulating = true` for demo mode
4. Update feed health with actual snapshot timestamps

### Phase 4: Pipeline Integration

**File**: `supabase/functions/data-pipeline-orchestrator/index.ts`

Adds both new functions to the orchestrator:
- `pp-props-scraper` in Phase 1 (Data Collection)
- `whale-signal-detector` in Phase 2 (Analysis)

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/pp-props-scraper/index.ts` | Create | Scrape PrizePicks via Firecrawl |
| `supabase/functions/whale-signal-detector/index.ts` | Create | Compare PP vs books, generate signals |
| `src/hooks/useWhaleProxy.ts` | Modify | Fetch real data from database |
| `supabase/functions/data-pipeline-orchestrator/index.ts` | Modify | Add new functions to pipeline |

---

## Technical Details

### PrizePicks API Structure

The internal PP API at `https://api.prizepicks.com/projections` returns:

```json
{
  "data": [
    {
      "id": "123",
      "attributes": {
        "line_score": 25.5,
        "stat_type": "Points"
      },
      "relationships": {
        "new_player": { "data": { "id": "456" } }
      }
    }
  ],
  "included": [
    {
      "id": "456",
      "type": "new_player",
      "attributes": { "display_name": "LeBron James" }
    }
  ]
}
```

### Signal Detection Algorithm

```typescript
function detectSignal(ppProp, bookConsensus) {
  const lineDiff = Math.abs(ppProp.line - bookConsensus.line);
  const divergence = Math.min(40, lineDiff * 8);
  
  const moveSpeed = calculateMoveSpeed(ppProp.previousLine, ppProp.line, minutesSinceChange);
  const confirmation = didBooksFollow(bookConsensus) ? 20 : 0;
  const boardBehavior = (wasFrozen ? 10 : 0) + (wasRelisted ? 5 : 0);
  
  const sharpScore = divergence + moveSpeed + confirmation + boardBehavior;
  
  if (sharpScore >= 55) {
    return createWhalePick(ppProp, sharpScore);
  }
}
```

### Deduplication Logic

- Market key: `{sport}_{player}_{stat_type}`
- No duplicate within 15 minutes unless `new_score - old_score >= 15`
- Auto-expire 5 minutes before game start

---

## Risk Considerations

| Risk | Mitigation |
|------|-----------|
| PP blocks scraper | Use Firecrawl's browser rendering + waitFor delays |
| API structure changes | Log raw responses, add fallback parsing |
| Rate limiting | Run every 5 min, not more frequently |
| TOS violation | Document that this is for personal use |

---

## Expected Results

When complete:
- **Simulate Live OFF**: Shows real PrizePicks props compared against FanDuel/DraftKings
- **Simulate Live ON**: Shows mock data for demo purposes
- **Real sharp signals** based on actual market divergences
- **Auto-updating** every 5 minutes via pipeline

The dashboard will display genuine opportunities where PrizePicks lines differ significantly from book consensus.

