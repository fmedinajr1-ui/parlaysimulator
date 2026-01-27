

# Fix Timestamp Parsing in PP Scraper

## Status: Almost There!

The Firecrawl JSON extraction is **working** - we successfully extracted 3 NBA projections from PrizePicks. The only issue is a timestamp format mismatch.

## The Problem

Firecrawl's LLM returns game times in human-readable format:
```json
{ "game_time": "7:00 PM" }
```

But the database `start_time` column expects a full ISO timestamp:
```
2026-01-27T19:00:00.000Z
```

## The Fix

Update `processExtractedProjections()` in `supabase/functions/pp-props-scraper/index.ts` to parse the time string and convert it to a proper timestamp.

### Code Change

Add a helper function to parse time strings:

```typescript
function parseGameTime(timeStr: string | undefined): string {
  if (!timeStr) {
    // Default to 24 hours from now
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  
  try {
    // Try parsing as ISO timestamp first
    const isoDate = new Date(timeStr);
    if (!isNaN(isoDate.getTime())) {
      return isoDate.toISOString();
    }
    
    // Parse time like "7:00 PM" or "7:30 PM ET"
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (timeMatch) {
      const [, hours, minutes, period] = timeMatch;
      let hour = parseInt(hours, 10);
      if (period.toUpperCase() === 'PM' && hour !== 12) hour += 12;
      if (period.toUpperCase() === 'AM' && hour === 12) hour = 0;
      
      // Use today's date with the parsed time
      const today = new Date();
      today.setHours(hour, parseInt(minutes, 10), 0, 0);
      
      // If the time has passed, assume it's tomorrow
      if (today < new Date()) {
        today.setDate(today.getDate() + 1);
      }
      
      return today.toISOString();
    }
  } catch (e) {
    console.log('[PP Scraper] Could not parse game_time:', timeStr);
  }
  
  // Fallback to 24 hours from now
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}
```

Then update line where `start_time` is set in `processExtractedProjections()`:

```typescript
// Change from:
start_time: proj.game_time || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),

// Change to:
start_time: parseGameTime(proj.game_time),
```

## Summary

| Status | Component |
|--------|-----------|
| Working | Firecrawl JSON extraction |
| Working | LLM projection parsing (3 found) |
| Working | Sport/stat normalization |
| Fix needed | `game_time` to `start_time` conversion |

After this fix, the data will insert successfully and the Whale Proxy will display real PrizePicks lines.

