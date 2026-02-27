

## Fix pp-props-scraper Timeout and Deploy All Pipeline Functions

### Problem 1: pp-props-scraper Statement Timeout
The logs show the function successfully fetches ~4,800 props but crashes on insert:
```
"canceling statement due to statement timeout"
```
**Root cause**: A single `supabase.insert()` call with ~4,800 rows exceeds the database statement timeout. Additionally, the "previous lines" query uses `.in('player_name', playerNames)` with thousands of names, which is also slow.

**Fix**: Batch inserts into chunks of 500 rows, and batch the previous-lines lookup similarly.

### Problem 2: Most Edge Functions Not Deployed
~150 functions exist in code but only ~10 are deployed. The entire automated pipeline is non-functional.

**Fix**: Deploy all functions in batches.

---

### Technical Changes

#### 1. Fix pp-props-scraper batched inserts (supabase/functions/pp-props-scraper/index.ts)

**Previous lines lookup** (line ~384-398): Batch the `.in()` query into chunks of 200 player names to avoid query size limits.

**Insert** (line ~408-415): Replace single bulk insert with batched inserts of 500 rows:
```typescript
// Batch insert in chunks of 500
const BATCH_SIZE = 500;
for (let i = 0; i < propsToInsert.length; i += BATCH_SIZE) {
  const batch = propsToInsert.slice(i, i + BATCH_SIZE);
  const { error } = await supabase.from('pp_snapshot').insert(batch);
  if (error) {
    console.error(`[PP Scraper] Batch ${i / BATCH_SIZE + 1} error:`, error);
    throw new Error(`Failed to insert batch: ${error.message}`);
  }
  console.log(`[PP Scraper] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} rows)`);
}
```

#### 2. Deploy all edge functions

Deploy all ~160 functions in batches using the deploy tool. This will be done in groups of ~20 to avoid overwhelming the deployment system. Functions will be deployed in priority order:
- **Batch 1**: Core pipeline (data-pipeline-orchestrator, engine-cascade-runner, prop-engine-v2, nba-player-prop-risk-engine, refresh-todays-props)
- **Batch 2**: Parlay builders (sharp-parlay-builder, heat-prop-engine, bot-generate-daily-parlays, bot-quality-regen-loop, bot-force-fresh-parlays, bot-review-and-optimize)
- **Batch 3**: Data collection (backfill-player-stats, calculate-season-stats, auto-classify-archetypes, daily-fatigue-calculator, firecrawl-lineup-scraper, fetch-vegas-lines, nba-team-pace-fetcher)
- **Batch 4**: Analysis engines (category-props-analyzer, detect-mispriced-lines, matchup-intelligence-analyzer, game-environment-validator, sync-archetypes, sync-matchup-history)
- **Batch 5**: Settlement and verification (bot-settle-and-learn, auto-settle-parlays, verify-risk-engine-outcomes, verify-sharp-outcomes, verify-whale-outcomes, etc.)
- **Batch 6-8**: All remaining functions (bot utilities, MLB/NFL/NHL/NCAAB modules, admin tools, checkout/billing, etc.)

