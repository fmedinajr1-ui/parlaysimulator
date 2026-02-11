

# Win-Rate-First Parlay Strategy + Boosted Odds Variants

## Overview
Restructure the bot's execution tier to prioritize **maximum win rate** by selecting only from the highest-hitting categories and picks, then automatically generate **boosted odds variants** of those same parlays by shopping for alternate lines on select legs.

## Current Problem
The bot generates parlays across all tiers with composite scoring that blends hit rate, edge, odds value, and category weight equally (30/25/25/20). This means a pick with 53% hit rate but great odds can outrank a 75% hit rate pick. The result: parlays that look good on paper but don't win consistently.

## Strategy

### 1. New "Max Win Rate" Profiles (Execution Tier)
Replace the current 8 execution profiles with a **win-rate-first** selection approach:

- **Sort picks strictly by L10 hit rate** (not composite score) for these profiles
- **Minimum hit rate floor: 60%** per leg (currently 55%)
- **Golden Category Lock**: Only draw from categories with 55%+ calibrated hit rate and 20+ samples
- **New profiles**:
  - 3-leg "Cash Lock" (3 legs, all 65%+ hit rate, main lines only)
  - 3-leg "Cash Lock" x2 (second variant for diversity)
  - 4-leg "Strong Cash" (4 legs, all 60%+ hit rate, main lines only)
  - 4-leg "Strong Cash" x2
  - 3-leg "Boosted Cash" (same 65%+ picks but with alt-line shopping on 1 leg)
  - 4-leg "Boosted Cash" (same 60%+ picks but with alt-line shopping on 1-2 legs)
  - 5-leg "Premium Boost" (60%+ picks, alt-lines on 2 legs, prefer plus-money)
  - 5-leg "Max Boost" (60%+ picks, aggressive alt-lines, all legs shopped)

### 2. Win-Rate-First Pick Selection
Add a new sorting mode in `generateTierParlays` that, for profiles tagged `sortBy: 'hit_rate'`, sorts the candidate pool by `l10_hit_rate` descending instead of `compositeScore`. This ensures the bot picks the most historically reliable legs first.

### 3. Boosted Odds Variant Generation
For "Boosted" profiles:
- Start with the same high-win-rate picks selected by the Cash Lock profiles
- Apply `selectOptimalLine` with `useAltLines: true` and `preferPlusMoney: true` on a subset of legs
- The `minBufferMultiplier` ensures the alt line is still safely within the projection buffer
- This creates a parlay with the same core picks but higher potential payout

### 4. Category Priority Queue
Build a priority queue from `bot_category_weights` where categories are ranked by `current_hit_rate`:
- **Tier 1 (65%+)**: THREE_POINT_SHOOTER, HIGH_ASSIST_UNDER, LOW_SCORER_UNDER
- **Tier 2 (55%+)**: ASSIST_ANCHOR, BIG_ASSIST_OVER, BIG_REBOUNDER
- Picks from Tier 1 categories are selected first, then Tier 2 fills remaining legs

## Technical Details

### File Modified
- `supabase/functions/bot-generate-daily-parlays/index.ts`

### Changes to ParlayProfile interface (line 37)
Add `sortBy` field:
```typescript
interface ParlayProfile {
  legs: number;
  strategy: string;
  sports?: string[];
  betTypes?: string[];
  minOddsValue?: number;
  minHitRate?: number;
  useAltLines?: boolean;
  minBufferMultiplier?: number;
  preferPlusMoney?: boolean;
  sortBy?: 'composite' | 'hit_rate';  // NEW
  boostLegs?: number;                  // NEW: how many legs to shop for alt lines
}
```

### New Execution Tier Profiles (replace lines 163-172)
```typescript
execution: {
  count: 10,  // increased from 8
  iterations: 25000,
  maxPlayerUsage: 3,
  maxTeamUsage: 2,
  maxCategoryUsage: 2,
  minHitRate: 60,       // raised from 55
  minEdge: 0.008,       // slightly relaxed since win rate is primary
  minSharpe: 0.02,
  stake: 'kelly',
  minConfidence: 0.60,  // raised from 0.55
  profiles: [
    // CASH LOCKS: Max win rate, main lines only
    { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: false },
    { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: false },
    { legs: 4, strategy: 'strong_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
    { legs: 4, strategy: 'strong_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
    // BOOSTED: Same high-rate picks, but shop odds on some legs
    { legs: 3, strategy: 'boosted_cash', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
    { legs: 4, strategy: 'boosted_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 2, minBufferMultiplier: 1.5 },
    { legs: 5, strategy: 'premium_boost', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 2, preferPlusMoney: true, minBufferMultiplier: 1.2 },
    { legs: 5, strategy: 'max_boost', sports: ['all'], minHitRate: 58, sortBy: 'hit_rate', useAltLines: true, boostLegs: 3, preferPlusMoney: true, minBufferMultiplier: 1.0 },
    // CROSS-SPORT cash plays
    { legs: 3, strategy: 'cash_lock_cross', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
    { legs: 4, strategy: 'strong_cash_cross', sports: ['all'], minHitRate: 58, sortBy: 'hit_rate', useAltLines: false },
  ],
},
```

### Modified pick selection in generateTierParlays (around line 1418-1429)
When `profile.sortBy === 'hit_rate'`, re-sort the candidate pool by hit rate:
```typescript
if (profile.sortBy === 'hit_rate') {
  candidatePicks = [...candidatePicks].sort((a, b) => {
    const aHitRate = 'l10_hit_rate' in a ? (a as EnrichedPick).l10_hit_rate : a.confidence_score;
    const bHitRate = 'l10_hit_rate' in b ? (b as EnrichedPick).l10_hit_rate : b.confidence_score;
    return bHitRate - aHitRate;
  });
}
```

### Boosted legs logic in line selection (around line 1477-1485)
Apply alt-line shopping only to the first N legs (controlled by `boostLegs`):
```typescript
const boostLimit = profile.boostLegs ?? (profile.useAltLines ? legs.length : 0);
const boostedCount = legs.filter(l => l.line_selection_reason !== 'main_line' && l.line_selection_reason !== 'safe_profile').length;

const selectedLine = (profile.useAltLines && boostedCount < boostLimit)
  ? selectOptimalLine(playerPick, playerPick.alternateLines || [], profile.strategy, profile.preferPlusMoney || false, profile.minBufferMultiplier || 1.0)
  : { line: playerPick.line, odds: playerPick.americanOdds, reason: 'main_line' };
```

### Validation Tier Update
Also raise the validation tier's hit rate floor slightly (52 to 55) and add 2 hit-rate-sorted profiles:
```typescript
{ legs: 3, strategy: 'validated_winrate', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate' },
{ legs: 4, strategy: 'validated_winrate', sports: ['basketball_nba'], minHitRate: 58, sortBy: 'hit_rate' },
```

## Expected Outcome
- **Cash Lock parlays**: 3-4 legs from 65%+ categories, conservative lines, highest probability of cashing
- **Boosted parlays**: Same reliable picks with 1-3 legs shopped for better odds, higher payout potential with similar base win probability
- Categories like THREE_POINT_SHOOTER (75%), HIGH_ASSIST_UNDER (75%), LOW_SCORER_UNDER (65%) will dominate execution-tier selections
- Clear labeling in the UI: "Cash Lock" vs "Boosted Cash" so you can see which are safe vs which are swinging for more

