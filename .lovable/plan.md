
# Plan: Enhanced PP Props Scraper with SPA Interaction & Reliable Odds Integration

## Overview

The current `pp-props-scraper` only captures ~3 projections per cycle because PrizePicks is a Single Page Application (SPA) that loads content dynamically. The scraper only "sees" the initial viewport without scrolling. This plan addresses both the scraping limitation and integrates reliable odds data from existing infrastructure.

## Current State Analysis

**Data Already Available:**
- `unified_props`: Contains 622 active NBA props from The Odds API/BallDontLie
- `pp_snapshot`: Has 709 NBA entries (mostly test/synthetic data)
- Existing `THE_ODDS_API_KEY` and `BALLDONTLIE_API_KEY` secrets are configured
- `FIRECRAWL_API_KEY` is connected via connector

**Current Scraper Limitations:**
1. Uses basic Firecrawl JSON extraction with only `waitFor: 8000`
2. No scrolling or page interaction to reveal additional props
3. PrizePicks loads ~8-12 props per viewport, with 100+ available via scroll
4. Fallback to synthetic data when extraction fails masks the real problem

---

## Phase 1: Enhanced PP Scraper with Firecrawl Actions

### Technical Changes to `pp-props-scraper/index.ts`

**1. Add Scroll Actions Sequence**

Replace the basic scrape call with an actions-based approach that scrolls multiple times:

```text
┌─────────────────────────────────────────────────────┐
│  Firecrawl Actions Sequence                         │
├─────────────────────────────────────────────────────┤
│  1. wait 3000ms (initial SPA load)                  │
│  2. scroll down (load more props)                   │
│  3. wait 1500ms (content render)                    │
│  4. scroll down (repeat)                            │
│  5. wait 1500ms                                     │
│  6. scroll down (repeat)                            │
│  7. wait 1500ms                                     │
│  8. scroll down (final scroll)                      │
│  9. wait 2000ms (final render)                      │
│  10. Extract JSON from full page                    │
└─────────────────────────────────────────────────────┘
```

**2. Updated Firecrawl Request Body**

```javascript
const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${firecrawlKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://app.prizepicks.com',
    actions: [
      { type: 'wait', milliseconds: 3000 },  // Wait for SPA hydration
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 1500 },
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 1500 },
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 1500 },
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 2000 },
    ],
    formats: ['json'],
    jsonOptions: {
      schema: { /* existing schema */ },
      prompt: 'Extract ALL player prop projections visible...'
    },
    timeout: 60000,  // Increased timeout for actions
    onlyMainContent: false,
  }),
});
```

**3. Add Sport-Specific Tab Navigation (Optional Enhancement)**

PrizePicks has sport tabs (NBA, NHL, etc.). We can click specific tabs:

```javascript
// Before scrolling, click the NBA tab
{ type: 'click', selector: '[data-testid="league-NBA"]' },
{ type: 'wait', milliseconds: 2000 },
// Then scroll sequence...
```

---

## Phase 2: Direct Odds API Integration (Parallel Data Source)

Instead of relying solely on web scraping, we'll use the existing `refresh-todays-props` function as the primary data source and enhance the signal detection to work with this data.

### Strategy: Use Existing Infrastructure

The `unified_props` table already contains reliable sportsbook data from:
- **The Odds API**: FanDuel, DraftKings lines
- **BallDontLie API**: Additional player props with game context

**Current Flow (Working):**
```text
refresh-todays-props → unified_props (622 active props)
                                ↓
                    whale-signal-detector
                                ↓
                         whale_picks
```

**Enhanced Flow:**
```text
┌────────────────────┐     ┌────────────────────┐
│  pp-props-scraper  │     │refresh-todays-props│
│  (Firecrawl+Scroll)│     │  (The Odds API)    │
└─────────┬──────────┘     └─────────┬──────────┘
          ↓                          ↓
    pp_snapshot                unified_props
          └──────────┬───────────────┘
                     ↓
           whale-signal-detector
                     ↓
               whale_picks
```

---

## Phase 3: Create Unified Props Fetcher for Multi-Sport Coverage

Create a new edge function `whale-odds-scraper` that fetches player props specifically for the Whale Proxy sports pool (NBA, NHL, WNBA, Tennis).

### New Function: `supabase/functions/whale-odds-scraper/index.ts`

**Purpose:** Fetch all player props for active sports into `unified_props`

**Key Features:**
1. Fetches events from The Odds API for each sport
2. Fetches player props for common markets (points, rebounds, assists, threes)
3. Deduplicates and upserts into `unified_props`
4. Runs every 5 minutes via cron

**Markets to Fetch:**
- `player_points`
- `player_rebounds`
- `player_assists`
- `player_threes`
- `player_blocks`
- `player_steals`

**Sports Coverage:**
- `basketball_nba`
- `basketball_wnba`
- `hockey_nhl`
- `tennis_atp`
- `tennis_wta`

---

## Phase 4: Enhanced Signal Detection Logic

Update `whale-signal-detector` to work better with the available data:

### Book-to-Book Divergence Enhancement

When PP data is unavailable, the detector already falls back to book-to-book divergence. We'll enhance this:

```javascript
// Current: Requires 1+ point spread between books
if (spread >= 1) { /* generate signal */ }

// Enhanced: Lower threshold + volume weighting
if (spread >= 0.5 && props.length >= 3) {
  // More books disagreeing = higher confidence
  const volumeBonus = Math.min(10, (props.length - 2) * 5);
  sharpScore = 50 + divergencePts + volumeBonus;
}
```

---

## Implementation Summary

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/pp-props-scraper/index.ts` | Modify | Add Firecrawl actions for scrolling |
| `supabase/functions/whale-odds-scraper/index.ts` | Create | Dedicated odds fetcher for Whale Proxy sports |
| `supabase/functions/whale-signal-detector/index.ts` | Modify | Enhance book divergence fallback logic |

### Cron Jobs to Configure

| Job | Schedule | Function |
|-----|----------|----------|
| `whale-pp-scraper-5min` | `*/5 * * * *` | `pp-props-scraper` |
| `whale-odds-scraper-5min` | `*/5 * * * *` | `whale-odds-scraper` |
| `whale-signal-detector-5min` | `*/5 * * * *` | `whale-signal-detector` |

---

## Technical Details

### PP Scraper Firecrawl Actions Implementation

```javascript
const SCROLL_ACTIONS = [
  { type: 'wait', milliseconds: 3000 },  // SPA initial load
  { type: 'scroll', direction: 'down' },
  { type: 'wait', milliseconds: 1500 },
  { type: 'scroll', direction: 'down' },
  { type: 'wait', milliseconds: 1500 },
  { type: 'scroll', direction: 'down' },
  { type: 'wait', milliseconds: 1500 },
  { type: 'scroll', direction: 'down' },
  { type: 'wait', milliseconds: 2000 },
];

const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${firecrawlKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://app.prizepicks.com',
    actions: SCROLL_ACTIONS,
    formats: ['json'],
    jsonOptions: {
      schema: existingSchema,
      prompt: 'Extract ALL player prop projections from the entire page...'
    },
    timeout: 90000,
    onlyMainContent: false,
  }),
});
```

### Whale Odds Scraper Core Logic

```javascript
const WHALE_SPORTS = [
  'basketball_nba',
  'basketball_wnba', 
  'hockey_nhl',
];

const MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
];

for (const sport of WHALE_SPORTS) {
  // 1. Fetch today's events
  const events = await fetchEventsFromOddsAPI(sport);
  
  // 2. For each event, fetch player props
  for (const event of events) {
    for (const market of MARKETS) {
      const props = await fetchPlayerProps(event.id, sport, market);
      allProps.push(...props);
    }
  }
}

// 3. Deduplicate and upsert
await supabase.from('unified_props').upsert(allProps, {
  onConflict: 'event_id,player_name,prop_type,bookmaker'
});
```

---

## Expected Outcomes

| Metric | Current | Expected |
|--------|---------|----------|
| PP props scraped per cycle | 3 | 30-50+ |
| Book props available | 622 (NBA only) | 800+ (multi-sport) |
| Signal generation | Book divergence only | PP + Book divergence |
| Data freshness | Sporadic | Every 5 minutes |

---

## Risk Mitigation

1. **Firecrawl Rate Limits**: Actions increase scrape time; implemented timeout buffer (90s)
2. **PrizePicks Blocking**: Firecrawl handles bot detection; fallback to book divergence if scraping fails
3. **API Credits**: The Odds API has quota; limited to essential markets only
4. **Data Validation**: Keep existing placeholder name filtering to reject test data
