

## New High-Conviction Strategies: Triple-Confirmed + Multi-Engine Conviction + Smarter Fallbacks

### The Gap Today

Your parlay engine currently has **one cross-reference layer**: mispriced lines x sweet spots = double-confirmed. But the `high-conviction-analyzer` already proves that 6 engines (Risk, PropV2, Sharp, Heat, MLB, Bot Parlays) often agree on the same picks -- and that data is **not being used** during parlay generation at all.

This means your best picks -- the ones where 3, 4, or even 5 independent engines all agree -- are getting the same priority as a pick with only 1 confirmation.

### Three New Strategies

#### 1. Triple-Confirmed Conviction (`triple_confirmed_conviction`)

A pick qualifies when **all three** independent systems agree:
- Sweet Spot: 70%+ L10 hit rate with direction
- Mispriced Lines: 15%+ statistical edge with direction  
- Risk Engine: Side agreement with confidence score

Today, risk engine agreement only gives a +12 composite boost. Triple-confirmed picks would get a **+30 bonus** and be tagged as `isTripleConfirmed`, creating an exclusive ultra-high-conviction pool.

```text
Current:  Sweet Spot + Mispriced = Double-Confirmed (+20 bonus)
Proposed: Sweet Spot + Mispriced + Risk Engine = Triple-Confirmed (+30 bonus)
```

#### 2. Multi-Engine Consensus (`multi_engine_consensus`)

Integrate the PropV2 and Sharp/Heat engine data directly into the parlay generation pool enrichment (currently only used in the separate high-conviction-analyzer). A pick gets an "engine count" -- the more engines that agree on the same player+prop+side, the higher it ranks.

```text
Engine count scoring:
  2 engines agree: +8 bonus
  3 engines agree: +16 bonus  
  4+ engines agree: +25 bonus (near-max conviction)
```

#### 3. Smarter Double-Confirmed Fallback (`double_confirmed_fallback`)

When the pure double-confirmed pool is empty (like today), instead of skipping entirely, fall back in tiers:
- **Tier A**: Mispriced picks with 65%+ real hit rate from sweet spots (partial double-confirmed)
- **Tier B**: Sweet spot picks with mispriced edge 10-14% (near-miss double-confirmed)  
- **Tier C**: Risk-engine-confirmed mispriced picks with 60%+ hit rate

This ensures the double-confirmed profiles ALWAYS generate something, with clear labeling of which fallback tier was used.

### Technical Details

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Change 1: Fetch PropV2 + Sharp/Heat data during pool building (~line 4227)**

After the risk engine fetch, add parallel queries for:
- `prop_engine_v2_picks` (game_date = today) -- SES score + side
- `sharp_ai_parlays` (parlay_date = today) -- extract legs
- `heat_parlays` (parlay_date = today) -- extract legs

Build a unified `multiEngineMap`: key = `player|prop_type`, value = `{ engines: string[], sides: string[] }`.

**Change 2: Triple-confirmed tagging during mispriced enrichment (~line 4267)**

During the existing mispriced pick enrichment loop, after checking `isDoubleConfirmed`, add:
```
if (isDoubleConfirmed && riskConfirmed) {
  isTripleConfirmed = true;
  tripleConfirmedBonus = 30;  // replaces the +20 double + +12 risk
}
```

Also tag with `engineCount` from the multi-engine map:
```
const multiMatch = multiEngineMap.get(key);
const engineCount = (multiMatch?.engines.length || 0) + (riskConfirmed ? 1 : 0) + (isDoubleConfirmed ? 1 : 0);
const multiEngineBonus = engineCount >= 4 ? 25 : engineCount >= 3 ? 16 : engineCount >= 2 ? 8 : 0;
```

**Change 3: Build triple-confirmed and multi-engine pools (~line 4378)**

After the existing `doubleConfirmedPicks` filter, add:
```
const tripleConfirmedPicks = filteredMispricedPicks.filter(p => p.isTripleConfirmed === true);
const multiEnginePicks = filteredMispricedPicks.filter(p => p.engineCount >= 3).sort(by compositeScore);
```

Add both to the pool return object.

**Change 4: Add new profile strategy handlers (~line 4522)**

Add `isTripleConfirmedProfile` and `isMultiEngineProfile` checks before the existing `isDoubleConfirmedProfile`:
```
if (isTripleConfirmedProfile) {
  candidatePicks = pool.tripleConfirmedPicks;
  // fallback to doubleConfirmedPicks if < legs needed
}
if (isMultiEngineProfile) {
  candidatePicks = pool.multiEnginePicks;
  // fallback to mispricedPicks sorted by engineCount
}
```

**Change 5: Double-confirmed fallback tiers (~line 4530)**

Replace the current `continue` when double-confirmed pool is too small:
```
if (candidatePicks.length < profile.legs) {
  // Tier A: partial double-confirmed (65%+ hit rate from sweet spots)
  candidatePicks = pool.mispricedPicks.filter(p => p.l10_hit_rate >= 0.65 && !p.isDoubleConfirmed);
  if (candidatePicks.length < profile.legs) {
    // Tier B: near-miss (sweet spot match with edge 10-14%)
    candidatePicks = pool.sweetSpots.filter(p => p.isDoubleConfirmed || p.mispricedEdge >= 10);
    if (candidatePicks.length < profile.legs) {
      // Tier C: risk-confirmed mispriced with 60%+ hit rate  
      candidatePicks = pool.mispricedPicks.filter(p => p.riskConfirmed && p.l10_hit_rate >= 0.60);
    }
  }
  // Log which fallback tier was used
}
```

**Change 6: Add profiles to TIER_CONFIG (~lines 136-321)**

Add across all three tiers:
```
// Exploration
{ legs: 3, strategy: 'triple_confirmed_conviction', sports: ['all'], minHitRate: 60, sortBy: 'composite' },
{ legs: 3, strategy: 'multi_engine_consensus', sports: ['all'], minHitRate: 55, sortBy: 'composite' },

// Validation  
{ legs: 3, strategy: 'triple_confirmed_conviction', sports: ['all'], minHitRate: 65, sortBy: 'composite' },
{ legs: 3, strategy: 'multi_engine_consensus', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'composite' },

// Execution
{ legs: 3, strategy: 'triple_confirmed_conviction', sports: ['all'], minHitRate: 70, sortBy: 'composite' },
```

**Change 7: Execution tier thin-slate relaxation (~line 4462)**

Add execution tier to the existing thin-slate relaxation block so it can still generate on light days:
```
if (isThinSlate && tier === 'execution') {
  config.minHitRate = 55;
  config.minEdge = 0.005;
}
```

### Summary of Data Flow

```text
POOL BUILDING:
  Sweet Spots (L10 hit rate) ─────────┐
  Mispriced Lines (edge %) ───────────┤
  Risk Engine (side + confidence) ────┤──> Enrichment Loop
  PropV2 (SES score + side) ──────────┤     │
  Sharp/Heat Parlays (legs) ──────────┘     │
                                            ▼
                                   Tag each pick:
                                   - isDoubleConfirmed (sweet + mispriced)
                                   - isTripleConfirmed (sweet + mispriced + risk)
                                   - engineCount (0-6 engines agree)
                                            │
                                            ▼
                                   Build 4 pools:
                                   1. tripleConfirmedPicks
                                   2. doubleConfirmedPicks  
                                   3. multiEnginePicks (3+ engines)
                                   4. mispricedPicks (all)
                                            │
                                            ▼
                                   Strategy Selection:
                                   triple > double > multi_engine > mispriced
                                   (with tiered fallbacks at each level)
```

### Safety Rails

- Triple-confirmed will be rare (maybe 2-5 picks/day) -- that's the point, they're the absolute best
- Multi-engine consensus requires 3+ independent engines agreeing -- no single-source flukes
- Fallback tiers are clearly logged so you can monitor which fallback level is being used
- All existing composite score sorting, usage caps, and fingerprint dedup remain unchanged
- If no PropV2/Sharp/Heat data exists for a day, engine count simply stays lower -- no errors

