
# Fix Whale Signal Detector + Add Fallback Signal Generation

## Root Cause Analysis

The Whale Proxy dashboard shows empty because of a multi-step failure:

1. **PP Scraper returns placeholder data** - Firecrawl is extracting "John Doe" and "Jane Smith" instead of real players, likely because:
   - PrizePicks board was empty when scraped (late night, no games)
   - The LLM couldn't find real projections on the page
   
2. **whale-signal-detector uses wrong field names** - The code references `market` and `point` but the `unified_props` table uses `prop_type` and `current_line`

3. **No matching players** - Since PP has "John Doe" and unified_props has real players like "Moe Wagner", there are zero matches

---

## Fix 1: Update whale-signal-detector Field Names

**File:** `supabase/functions/whale-signal-detector/index.ts`

Update the `UnifiedProp` interface and query logic to use correct schema fields:

```typescript
// Change interface (lines 23-34)
interface UnifiedProp {
  id: string;
  player_name: string;
  prop_type: string;        // Was: market
  current_line: number;     // Was: point
  sport: string;
  event_id: string;
  bookmaker: string;
  game_description: string; // Was: home_team/away_team
  commence_time: string;
}
```

Update the consensus map logic (lines 146-166):
```typescript
for (const prop of books) {
  // Normalize prop_type to stat type (was: market)
  const statType = prop.prop_type.replace('player_', '');
  const key = `${prop.player_name.toLowerCase()}_${statType}`;
  
  if (!consensusMap.has(key)) {
    consensusMap.set(key, {
      avgLine: prop.current_line,              // Was: point
      lines: [prop.current_line],              // Was: point
      matchup: prop.game_description || 'TBD', // Was: away_team @ home_team
      startTime: prop.commence_time,
    });
  } else {
    const existing = consensusMap.get(key)!;
    existing.lines.push(prop.current_line);    // Was: point
    existing.avgLine = existing.lines.reduce((a, b) => a + b, 0) / existing.lines.length;
  }
}
```

---

## Fix 2: Add Book-to-Book Divergence Fallback

When no PP data is available, generate signals by comparing divergence between bookmakers (FanDuel vs DraftKings).

Add to whale-signal-detector after line 127 (when no PP snapshots):

```typescript
// Fallback: Generate signals from book-to-book divergence
if (snapshots.length === 0) {
  console.log('[Whale Detector] No PP data, checking book divergence...');
  
  const { data: bookDivergence } = await supabase
    .from('unified_props')
    .select('*')
    .in('sport', sports)
    .gt('commence_time', now.toISOString())
    .order('commence_time', { ascending: true })
    .limit(200);
  
  if (bookDivergence && bookDivergence.length > 0) {
    // Group by player + prop_type, find divergent lines
    const playerMap = new Map();
    for (const prop of bookDivergence) {
      const key = `${prop.player_name}_${prop.prop_type}`;
      if (!playerMap.has(key)) {
        playerMap.set(key, []);
      }
      playerMap.get(key).push(prop);
    }
    
    // Find props where bookmakers disagree by > 1 point
    for (const [key, props] of playerMap) {
      if (props.length < 2) continue;
      
      const lines = props.map(p => p.current_line);
      const spread = Math.max(...lines) - Math.min(...lines);
      
      if (spread >= 1) {
        // Generate divergence signal
        const avgLine = lines.reduce((a, b) => a + b, 0) / lines.length;
        // ... create signal with signal_type: 'book_divergence'
      }
    }
  }
}
```

---

## Fix 3: Update pp-props-scraper for Better Extraction

The Firecrawl extraction is returning test data. Add validation and better logging:

**File:** `supabase/functions/pp-props-scraper/index.ts`

Add validation after extraction (around line 175):

```typescript
// Validate extracted projections have real player names
const validProjections = extractedData.projections.filter(p => {
  const name = p.player_name?.toLowerCase() || '';
  // Filter out obvious test/placeholder names
  if (name.includes('john doe') || name.includes('jane') || name.includes('test')) {
    console.log('[PP Scraper] Filtering placeholder name:', p.player_name);
    return false;
  }
  // Player names should have at least 2 parts (first + last)
  if (p.player_name?.split(' ').length < 2) {
    return false;
  }
  return true;
});

if (validProjections.length === 0) {
  console.log('[PP Scraper] All extracted projections were invalid/placeholder');
  // Fall through to fallback logic
}
```

---

## Expected Data Flow After Fix

```
                    +------------------+
                    |  PrizePicks.com  |
                    +--------+---------+
                             |
                   Firecrawl JSON Extract
                             |
                    +--------v---------+
                    |   pp_snapshot    |
                    |  (real players)  |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
    +--------v---------+          +--------v---------+
    |  unified_props   |          |  whale-signal-   |
    |  (FD/DK lines)   |          |    detector      |
    +--------+---------+          +--------+---------+
              |                             |
              +----------+------------------+
                         |
                +--------v---------+
                |   whale_picks    |
                |  (with signals)  |
                +--------+---------+
                         |
                +--------v---------+
                |  WhaleProxyDash  |
                |    (Frontend)    |
                +------------------+
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/whale-signal-detector/index.ts` | Fix field names (`prop_type`, `current_line`), add book divergence fallback |
| `supabase/functions/pp-props-scraper/index.ts` | Add validation to filter placeholder/test names |

---

## Technical Notes

1. **Field name mismatch was caused by schema drift** - the unified_props table was updated but the whale-signal-detector wasn't synced
2. **Placeholder data in PP scraper** happens when PrizePicks board is empty or the LLM can't identify real projections
3. **Book divergence fallback** ensures the whale proxy always has signals even without PP data
4. **Validation filter** prevents garbage data from entering the system

After implementing these fixes, the Whale Proxy will display real signals from either:
- PP vs Book divergence (primary)
- Book vs Book divergence (fallback)
