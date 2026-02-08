
# Enhanced Autonomous Bot: Multi-Odds Comparison & 8-10 Daily Parlays

## Overview

Upgrade the bot to:
1. **Compare odds across the -200 to +200 range** for optimal value detection
2. **Generate 8-10 unique parlays daily** with varying leg counts (3-6 legs)
3. **Eliminate duplicate picks** across parlays using player-prop deduplication
4. **Score picks based on odds value** (juiced vs de-juiced lines)

## Current State Analysis

### What Exists
| Component | Status |
|-----------|--------|
| `bot-generate-daily-parlays` | Generates only 3 parlays/day, fixed 6-leg |
| `unified_props` | Has `over_price`, `under_price` columns (-200 to +200 range) |
| `hybrid-monte-carlo.ts` | Calculates probabilities but doesn't factor odds juice |
| `fetch-current-odds` | Can fetch live odds from multiple bookmakers |

### Gaps Identified
1. **No odds comparison** - Bot uses implied probabilities but doesn't compare actual book odds
2. **Fixed 3 parlays/day** - Need 8-10 with varying structures
3. **No deduplication** - Same player can appear in multiple parlays
4. **No odds-based scoring** - Juiced lines (-130) vs Plus-money (+110) not weighted

## Implementation Plan

### Phase 1: Odds Value Scoring Engine

#### 1.1 Create `calculateOddsValue()` Function

Add to `src/lib/parlay-calculator.ts`:

```typescript
/**
 * Calculate value score based on odds vs implied probability
 * Range: -200 to +200 American odds
 * 
 * Returns: value score from 0-100
 * - 100 = Maximum value (plus money on high-probability pick)
 * - 50 = Fair value (standard -110 juice)
 * - 0 = Poor value (heavily juiced line)
 */
function calculateOddsValueScore(
  americanOdds: number,
  estimatedHitRate: number
): number {
  // Convert odds to implied probability
  const impliedProb = americanToImplied(americanOdds);
  
  // Calculate edge (estimated - implied)
  const edge = estimatedHitRate - impliedProb;
  
  // Juice factor: how much are you overpaying?
  // -110 = 52.4% implied (fair)
  // -130 = 56.5% implied (overpaying)
  // +110 = 47.6% implied (value)
  const juicePenalty = Math.max(0, impliedProb - 0.524) * 100;
  const juiceBonus = Math.max(0, 0.524 - impliedProb) * 80;
  
  // Edge contribution (bigger edge = better)
  const edgeScore = Math.min(40, edge * 400);
  
  // Base score + edge + juice adjustment
  const score = 50 + edgeScore - juicePenalty + juiceBonus;
  
  return Math.max(0, Math.min(100, score));
}
```

#### 1.2 Add Odds Filtering to Bot Rules

Update `BOT_RULES` in `useBotEngine.ts`:

```typescript
export const BOT_RULES = {
  // Existing rules...
  
  // NEW: Odds filtering
  MIN_ODDS: -200,           // Don't bet on heavy favorites
  MAX_ODDS: 200,            // Don't bet on long shots
  PREFER_PLUS_MONEY: true,  // Prioritize plus-money lines
  MIN_ODDS_VALUE_SCORE: 45, // Minimum odds value score
  
  // NEW: Volume rules
  DAILY_PARLAYS_MIN: 8,     // Minimum parlays per day
  DAILY_PARLAYS_MAX: 10,    // Maximum parlays per day
  LEG_COUNTS: [3, 4, 5, 6], // Varying leg counts
};
```

### Phase 2: Enhanced Parlay Generation

#### 2.1 Update `bot-generate-daily-parlays` Edge Function

Major refactor to generate 8-10 unique parlays:

```text
GENERATION FLOW:

1. LOAD DATA
   ├── Category weights (60%+ hit rate only)
   ├── All eligible picks from category_sweet_spots
   └── Live odds from unified_props (over_price, under_price)

2. SCORE ALL PICKS
   For each pick:
   ├── Base score = L10 hit rate * category weight
   ├── Odds value score = calculateOddsValueScore()
   ├── Edge score = projected - line
   └── Total score = weighted combination

3. CREATE PICK POOL (Deduplicated)
   - Sort by total score descending
   - Track used: Map<"player_prop", boolean>
   - Pool size: 40-60 picks

4. GENERATE PARLAYS (8-10 unique)
   For parlayNum = 1 to 10:
   ├── Determine leg count: [3, 4, 4, 5, 5, 5, 6, 6, 6, 6]
   ├── Select legs using greedy algorithm:
   │   ├── Skip already-used player+prop combinations
   │   ├── Max 2 per team (existing rule)
   │   ├── Diversify categories (max 3 from same category)
   │   └── Balance overs/unders (40-60% split)
   ├── Run MC simulation (10K iterations for speed)
   ├── If passes thresholds → Add to output
   └── Mark used picks to prevent duplicates

5. VALIDATION
   - Ensure 8+ parlays generated
   - Ensure no duplicate player+prop across parlays
   - Ensure varying leg counts represented
```

#### 2.2 Parlay Diversity Strategy

Create different "profiles" for the 10 daily parlays:

| Parlay # | Legs | Strategy | Risk Level |
|----------|------|----------|------------|
| 1-2 | 3 | Conservative - Top 3 picks only | Low |
| 3-4 | 4 | Balanced - Mix ELITE + RELIABLE | Medium |
| 5-7 | 5 | Standard - Diversified categories | Medium |
| 8-10 | 6 | Aggressive - Higher edge required | Higher |

### Phase 3: Deduplication System

#### 3.1 Create Global Usage Tracker

```typescript
interface UsageTracker {
  // Track used player+prop+side combinations
  usedPicks: Set<string>; // "LeBron James_points_over"
  
  // Track player usage (max 2 parlays per player)
  playerUsageCount: Map<string, number>;
  
  // Track category distribution
  categoryUsageCount: Map<string, number>;
}

function createPickKey(pick: SweetSpotPick): string {
  return `${pick.player_name}_${pick.prop_type}_${pick.side}`.toLowerCase();
}

function canUsePick(
  pick: SweetSpotPick,
  tracker: UsageTracker
): boolean {
  const key = createPickKey(pick);
  
  // Never reuse same pick
  if (tracker.usedPicks.has(key)) return false;
  
  // Max 2 parlays per player
  const playerCount = tracker.playerUsageCount.get(pick.player_name) || 0;
  if (playerCount >= 2) return false;
  
  return true;
}
```

### Phase 4: Odds Comparison Integration

#### 4.1 Enrich Picks with Live Odds

Before scoring, fetch current odds:

```typescript
async function enrichPicksWithOdds(
  picks: SweetSpotPick[],
  supabase: any
): Promise<EnrichedPick[]> {
  // Get odds from unified_props
  const { data: oddsData } = await supabase
    .from('unified_props')
    .select('player_name, prop_type, over_price, under_price')
    .in('player_name', picks.map(p => p.player_name))
    .is('is_active', true);
  
  const oddsMap = new Map();
  for (const od of oddsData || []) {
    const key = `${od.player_name}_${od.prop_type}`;
    oddsMap.set(key, {
      overOdds: od.over_price,
      underOdds: od.under_price
    });
  }
  
  return picks.map(pick => {
    const key = `${pick.player_name}_${pick.prop_type}`;
    const odds = oddsMap.get(key) || { overOdds: -110, underOdds: -110 };
    const relevantOdds = pick.side === 'over' ? odds.overOdds : odds.underOdds;
    
    return {
      ...pick,
      americanOdds: relevantOdds,
      oddsValueScore: calculateOddsValueScore(relevantOdds, pick.l10HitRate / 100)
    };
  });
}
```

#### 4.2 Filter by Odds Range

```typescript
function filterByOddsRange(
  picks: EnrichedPick[],
  minOdds: number = -200,
  maxOdds: number = 200
): EnrichedPick[] {
  return picks.filter(p => {
    const odds = p.americanOdds;
    
    // Must be within range
    if (odds < minOdds || odds > maxOdds) return false;
    
    // Warn on heavily juiced lines
    if (odds <= -180) {
      console.log(`[OddsFilter] ${p.player_name}: Heavily juiced ${odds}, value: ${p.oddsValueScore}`);
      return p.oddsValueScore >= 50; // Only allow if exceptional value
    }
    
    return true;
  });
}
```

### Phase 5: Updated Scoring Formula

#### 5.1 New Composite Scoring

```typescript
function calculateCompositeBotScore(
  pick: EnrichedPick,
  categoryWeight: number
): number {
  // Component weights
  const WEIGHTS = {
    hitRate: 0.30,     // Historical accuracy
    edge: 0.25,        // Projection vs line
    oddsValue: 0.25,   // Betting value
    categoryWeight: 0.20, // Bot learning weight
  };
  
  // Normalize components to 0-100 scale
  const hitRateScore = Math.min(100, pick.l10HitRate || 50);
  const edgeScore = Math.min(100, Math.max(0, pick.edge * 20 + 50));
  const oddsValueScore = pick.oddsValueScore || 50;
  const weightScore = categoryWeight * 66.67; // 1.5 max → 100
  
  // Weighted sum
  const composite = 
    (hitRateScore * WEIGHTS.hitRate) +
    (edgeScore * WEIGHTS.edge) +
    (oddsValueScore * WEIGHTS.oddsValue) +
    (weightScore * WEIGHTS.categoryWeight);
  
  return Math.round(composite);
}
```

### Phase 6: Edge Function Changes

#### 6.1 Updated `bot-generate-daily-parlays/index.ts`

Key changes:
- Generate 8-10 parlays instead of 3
- Varying leg counts: 3, 4, 5, 6
- Odds value scoring integration
- Global deduplication across all parlays
- MC simulation for each parlay (10K iterations for speed)

#### 6.2 New Parlay Profiles

```typescript
const PARLAY_PROFILES = [
  { legs: 3, strategy: 'conservative', minOddsValue: 55, minHitRate: 68 },
  { legs: 3, strategy: 'conservative', minOddsValue: 55, minHitRate: 68 },
  { legs: 4, strategy: 'balanced', minOddsValue: 50, minHitRate: 62 },
  { legs: 4, strategy: 'balanced', minOddsValue: 50, minHitRate: 62 },
  { legs: 5, strategy: 'standard', minOddsValue: 45, minHitRate: 58 },
  { legs: 5, strategy: 'standard', minOddsValue: 45, minHitRate: 58 },
  { legs: 5, strategy: 'standard', minOddsValue: 45, minHitRate: 58 },
  { legs: 6, strategy: 'aggressive', minOddsValue: 40, minHitRate: 55 },
  { legs: 6, strategy: 'aggressive', minOddsValue: 40, minHitRate: 55 },
  { legs: 6, strategy: 'aggressive', minOddsValue: 40, minHitRate: 55 },
];
```

### Phase 7: UI Updates

#### 7.1 Update `BotDashboard.tsx`

- Show parlay count: "8 of 10 generated today"
- Group by leg count: "3-Leg (2) | 4-Leg (2) | 5-Leg (3) | 6-Leg (3)"
- Add odds value indicator on each leg

#### 7.2 Update `BotParlayCard.tsx`

Add odds display for each leg:
```text
LeBron James
Points OVER 25.5 • Lakers
Odds: -115 | Value: 72/100
```

### File Changes Summary

| File | Change |
|------|--------|
| `src/lib/parlay-calculator.ts` | Add `calculateOddsValueScore()` function |
| `src/hooks/useBotEngine.ts` | Update `BOT_RULES`, add deduplication types |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Major refactor for 8-10 parlays, odds scoring |
| `src/pages/BotDashboard.tsx` | Add parlay count display, grouping |
| `src/components/bot/BotParlayCard.tsx` | Add odds value display |

### Expected Output

After implementation, daily bot generation will produce:

```text
Day 1 (9 AM ET):
  Generated 10 parlays:
  - 2x 3-leg (Conservative): +280, +310
  - 2x 4-leg (Balanced): +520, +580
  - 3x 5-leg (Standard): +850, +920, +1050
  - 3x 6-leg (Aggressive): +1400, +1650, +1800
  
  No duplicate picks across parlays
  All picks within -200 to +200 odds range
  Average odds value score: 62/100
```

### Technical Details

#### Scoring Example

```text
Pick: LeBron James Points OVER 25.5
- L10 Hit Rate: 72%
- Odds: -115 (implied: 53.5%)
- Projection: 27.2 (edge: +1.7)
- Category Weight: 1.15

Odds Value Score:
- Edge: 72% - 53.5% = 18.5% → +40 points
- Juice: -115 is slightly juiced → -3 points
- Base: 50
- Total: 87/100 (Excellent value)

Composite Score:
- Hit Rate: 72 * 0.30 = 21.6
- Edge: 67 * 0.25 = 16.75
- Odds Value: 87 * 0.25 = 21.75
- Category: 77 * 0.20 = 15.4
- TOTAL: 75.5/100
```

#### Deduplication Example

```text
Parlay 1 uses: LeBron_points_over, Curry_threes_over, Jokic_assists_over
Parlay 2 cannot use: LeBron_points_over (already used)
Parlay 2 can use: LeBron_rebounds_over (different prop)
Parlay 3 cannot use: LeBron (already in 2 parlays)
```
