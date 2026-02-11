

# Close the Research-to-Generation Gap

## Problem
The bot collects valuable research data (injury intelligence, statistical model recommendations, sharp money signals) but **never uses any of it** during parlay generation. Out of 149 research findings, 9 are flagged actionable with 0 acted upon. This is the single biggest disconnect in the pipeline.

## What Needs to Change

### 1. Feed Research Injury Intel Into the Generator
Currently the generator only checks `lineup_alerts` for injury data. The research agent independently fetches detailed injury reports from Perplexity (player OUT statuses, usage impact analysis, minute projections for replacements) but stores them in `bot_research_findings` where they're never read.

**Fix**: Add a `fetchResearchInjuryIntel` function that queries today's `bot_research_findings` where `category = 'injury_intel'` and extracts player names with OUT/Questionable statuses. Merge these into the existing injury blocklist as a secondary source, so even if `lineup_alerts` is stale, the research data catches gaps.

### 2. Apply Statistical Model Insights to Scoring
Research findings in the `statistical_models` category contain specific recommendations like:
- Kelly Criterion sizing formulas
- Bayesian projection adjustments using recent form
- Sharp money detection thresholds (5-10% edge minimum)
- Per-36 scaling for usage rate changes

**Fix**: Parse the most recent `statistical_models` finding and extract the minimum edge threshold. Feed this into the tier config's `minEdge` parameter dynamically rather than using a hardcoded 0.008. If research says "target 5-10% edges", set `minEdge: 0.05`.

### 3. Mark Research as Acted Upon
After the generator reads and applies a research finding, update `action_taken` on that row so we can track what's been consumed vs ignored.

### 4. Fix Settlement Accuracy
Won parlays showing `legs_hit < leg_count` (e.g., 5-leg with 3 hit) indicates voided legs are being ignored rather than treated properly. A 5-leg parlay with 2 voided legs and 3 hits should be settled as a 3-leg parlay win, but the `legs_hit` count needs to accurately reflect this for learning to work.

**Fix**: Update settlement logic to set `legs_hit` = actual hits and `leg_count` = non-voided legs (or add `legs_voided` column) so win rate calculations are accurate.

### 5. Track New Strategy Profiles
The new cash_lock, boosted_cash, premium_boost, and max_boost strategies need entries in `bot_strategies` so their individual win rates can be monitored and compared.

## Technical Details

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

#### New function: `fetchResearchInjuryIntel`
```typescript
async function fetchResearchInjuryIntel(
  supabase: any,
  gameDate: string
): Promise<Set<string>> {
  const researchBlocklist = new Set<string>();
  
  const { data } = await supabase
    .from('bot_research_findings')
    .select('key_insights')
    .eq('category', 'injury_intel')
    .eq('research_date', gameDate)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!data?.length) return researchBlocklist;

  // Extract player names with "Out" status from research text
  const outPattern = /([A-Z][a-z]+ [A-Z][a-z]+)\s+(?:Out|OUT)/g;
  for (const finding of data) {
    const insights = Array.isArray(finding.key_insights) 
      ? finding.key_insights.join(' ') 
      : String(finding.key_insights);
    let match;
    while ((match = outPattern.exec(insights)) !== null) {
      researchBlocklist.add(match[1].toLowerCase().trim());
    }
  }

  console.log(`[ResearchIntel] Found ${researchBlocklist.size} OUT players from research`);
  return researchBlocklist;
}
```

#### Integration in Promise.all block (around line 970)
```typescript
const [activePlayersToday, injuryData, teamsPlayingToday, researchBlocklist] = await Promise.all([
  fetchActivePlayersToday(supabase, startUtc, endUtc),
  fetchInjuryBlocklist(supabase, gameDate),
  fetchTeamsPlayingToday(supabase, startUtc, endUtc, gameDate),
  fetchResearchInjuryIntel(supabase, gameDate),
]);

// Merge research blocklist into injury blocklist
for (const player of researchBlocklist) {
  blocklist.add(player);
}
```

#### New function: `fetchResearchEdgeThreshold`
```typescript
async function fetchResearchEdgeThreshold(supabase: any): Promise<number | null> {
  const { data } = await supabase
    .from('bot_research_findings')
    .select('key_insights')
    .eq('category', 'statistical_models')
    .eq('actionable', true)
    .is('action_taken', null)
    .order('relevance_score', { ascending: false })
    .limit(1);

  if (!data?.[0]) return null;
  
  const text = Array.isArray(data[0].key_insights) 
    ? data[0].key_insights.join(' ') 
    : String(data[0].key_insights);
  
  // Extract edge threshold recommendation (e.g., "edge > 5%")
  const edgeMatch = text.match(/edge\s*[>≥]\s*(\d+(?:\.\d+)?)\s*%/i);
  if (edgeMatch) {
    return parseFloat(edgeMatch[1]) / 100;
  }
  return null;
}
```

#### Mark findings as consumed (after generation completes)
```typescript
await supabase
  .from('bot_research_findings')
  .update({ action_taken: `Applied to generation on ${gameDate}` })
  .eq('category', 'injury_intel')
  .eq('research_date', gameDate)
  .is('action_taken', null);
```

### Database Migration: Add `legs_voided` column
```sql
ALTER TABLE bot_daily_parlays ADD COLUMN IF NOT EXISTS legs_voided integer DEFAULT 0;
```

### Database Migration: Insert new strategy entries
```sql
INSERT INTO bot_strategies (strategy_name, description, is_active, times_used, times_won, win_rate, roi)
VALUES 
  ('cash_lock', '3-leg max win rate, main lines only, 65%+ hit rate per leg', true, 0, 0, 0, 0),
  ('strong_cash', '4-leg high win rate, main lines only, 60%+ hit rate', true, 0, 0, 0, 0),
  ('boosted_cash', 'High win rate picks with alt-line shopping on 1-2 legs', true, 0, 0, 0, 0),
  ('premium_boost', '5-leg 60%+ with 2 boosted legs, plus-money preferred', true, 0, 0, 0, 0),
  ('max_boost', '5-leg aggressive alt-lines on all legs', true, 0, 0, 0, 0)
ON CONFLICT (strategy_name) DO NOTHING;
```

## Expected Impact
- Research injury data plugs gaps where `lineup_alerts` is stale (catches late scratches)
- Edge threshold from statistical models raises the quality floor dynamically
- Accurate `legs_voided` tracking fixes misleading win rate calculations
- Strategy-level tracking enables comparing cash_lock vs boosted performance over time
- Every piece of stored research data is now consumed and marked, closing the feedback loop

