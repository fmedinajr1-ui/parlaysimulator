

# High-Volume Tiered Parlay Generation System

## Executive Summary

Transform the bot from generating **8-10 parlays/day** to a tiered system producing **65-75 parlays/day** across three learning tiers, reducing the time to statistical confidence from 5-6 months to **4-6 weeks**.

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    TIERED PARLAY ENGINE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│   │   EXPLORATION    │  │    VALIDATION    │  │   EXECUTION     │  │
│   │   50 parlays/day │  │  15 parlays/day  │  │  8 parlays/day  │  │
│   │                  │  │                  │  │                 │  │
│   │  • $0 stake      │  │  • Sim stake     │  │  • Real/Kelly   │  │
│   │  • 2K MC iters   │  │  • 10K MC iters  │  │  • 25K MC iters │  │
│   │  • 3 max/player  │  │  • 2 max/player  │  │  • 1 max/player │  │
│   │  • Edge discovery│  │  • Pattern valid │  │  • Best bets    │  │
│   └────────┬─────────┘  └────────┬─────────┘  └────────┬────────┘  │
│            │                     │                     │            │
│            └──────────┬──────────┴──────────┬──────────┘            │
│                       ▼                     ▼                       │
│               ┌──────────────────────────────────────┐              │
│               │         LEARNING ENGINE              │              │
│               │  • Category weight updates           │              │
│               │  • Strategy evolution                │              │
│               │  • Cross-tier insights               │              │
│               └──────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Database Schema Updates

### 1.1 Add Tier Column to Parlays Table

```sql
ALTER TABLE bot_daily_parlays 
ADD COLUMN tier TEXT DEFAULT 'execution' 
CHECK (tier IN ('exploration', 'validation', 'execution'));

ALTER TABLE bot_daily_parlays 
ADD COLUMN tier_config JSONB DEFAULT '{}';

-- Index for tier-based queries
CREATE INDEX idx_parlays_tier ON bot_daily_parlays(tier, parlay_date);
```

### 1.2 New Learning Metrics Table

```sql
CREATE TABLE bot_learning_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  tier TEXT NOT NULL,
  sport TEXT NOT NULL,
  
  -- Volume metrics
  parlays_generated INTEGER DEFAULT 0,
  parlays_settled INTEGER DEFAULT 0,
  
  -- Performance metrics
  win_rate NUMERIC,
  avg_edge NUMERIC,
  avg_sharpe NUMERIC,
  
  -- Learning velocity
  category_updates INTEGER DEFAULT 0,
  weight_convergence NUMERIC, -- 0-1 measure of weight stability
  
  -- Confidence interval
  confidence_interval_lower NUMERIC,
  confidence_interval_upper NUMERIC,
  sample_sufficiency NUMERIC, -- % of minimum sample size reached
  
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(metric_date, tier, sport)
);
```

### 1.3 Sport-Specific Category Weights

```sql
ALTER TABLE bot_category_weights 
ADD COLUMN sport TEXT DEFAULT 'basketball_nba';

-- Make unique constraint sport-aware
ALTER TABLE bot_category_weights 
DROP CONSTRAINT IF EXISTS bot_category_weights_category_side_key;

ALTER TABLE bot_category_weights 
ADD CONSTRAINT bot_category_weights_category_side_sport_key 
UNIQUE(category, side, sport);
```

---

## Phase 2: Enhanced Generation Engine

### 2.1 Tiered Profile System

```typescript
// New tier definitions in bot-generate-daily-parlays
const TIER_CONFIG = {
  exploration: {
    count: 50,
    iterations: 2000,
    maxPlayerUsage: 3,
    maxTeamUsage: 3,
    maxCategoryUsage: 5,
    minHitRate: 45,      // Lower threshold for edge discovery
    minEdge: 0.01,       // Accept lower edge
    minSharpe: 0.2,
    stake: 0,            // $0 stake - pure learning
    profiles: [
      // Multi-sport exploration
      { legs: 3, strategy: 'explore_safe', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 4, strategy: 'explore_mixed', sports: ['all'] },
      { legs: 5, strategy: 'explore_aggressive', sports: ['all'] },
      { legs: 3, strategy: 'team_props', betTypes: ['spread', 'total'] },
      // ... 46 more profiles
    ]
  },
  validation: {
    count: 15,
    iterations: 10000,
    maxPlayerUsage: 2,
    maxTeamUsage: 2,
    maxCategoryUsage: 3,
    minHitRate: 52,
    minEdge: 0.025,
    minSharpe: 0.4,
    stake: 50,           // Simulated stake
    profiles: [
      { legs: 3, strategy: 'validated_conservative', sports: ['basketball_nba'] },
      { legs: 4, strategy: 'validated_balanced', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 5, strategy: 'validated_standard', sports: ['all'] },
      // ... 12 more profiles
    ]
  },
  execution: {
    count: 8,
    iterations: 25000,
    maxPlayerUsage: 1,
    maxTeamUsage: 1,
    maxCategoryUsage: 2,
    minHitRate: 55,
    minEdge: 0.03,
    minSharpe: 0.5,
    stake: 'kelly',      // Kelly-sized stake
    profiles: [
      { legs: 3, strategy: 'elite_conservative' },
      { legs: 4, strategy: 'elite_balanced' },
      { legs: 5, strategy: 'elite_standard' },
      { legs: 6, strategy: 'elite_aggressive' },
      // ... 4 more profiles
    ]
  }
};
```

### 2.2 Multi-Sport Pool Builder

```typescript
// Aggregate props from all sources
async function buildPropPool(supabase: any, targetDate: string) {
  // Player props from unified_props
  const { data: playerProps } = await supabase
    .from('unified_props')
    .select('*')
    .eq('is_active', true)
    .in('sport', ['basketball_nba', 'icehockey_nhl', 'tennis_atp', 'tennis_wta']);
  
  // Team props from game_bets
  const { data: teamProps } = await supabase
    .from('game_bets')
    .select('*')
    .eq('is_active', true)
    .gte('commence_time', new Date().toISOString());
  
  // Sweet spot picks (analyzed)
  const { data: sweetSpots } = await supabase
    .from('category_sweet_spots')
    .select('*')
    .eq('analysis_date', targetDate)
    .eq('is_active', true);
  
  return {
    playerProps: playerProps || [],
    teamProps: teamProps || [],
    sweetSpots: sweetSpots || [],
    totalPool: (playerProps?.length || 0) + (teamProps?.length || 0),
  };
}
```

### 2.3 Parallel Generation with Batching

```typescript
// Generate all tiers in parallel with different configs
async function generateAllTiers(supabase: any, targetDate: string, pool: PropPool) {
  const tiers = ['exploration', 'validation', 'execution'];
  
  const results = await Promise.all(
    tiers.map(tier => generateTierParlays(supabase, tier, targetDate, pool))
  );
  
  return {
    exploration: results[0],
    validation: results[1],
    execution: results[2],
    total: results.reduce((sum, r) => sum + r.count, 0),
  };
}
```

---

## Phase 3: Multi-Sport Category System

### 3.1 Sport-Specific Categories

| Sport | Categories |
|-------|------------|
| **NHL** | `GOAL_SCORER`, `PLAYMAKER_ASSISTS`, `SHOT_VOLUME`, `GOALIE_SAVES`, `POWER_PLAY` |
| **Tennis** | `ACE_MACHINE`, `TIGHT_MATCHER`, `SERVICE_HOLD`, `BREAK_POINT` |
| **Team (All)** | `SHARP_SPREAD_HOME`, `SHARP_SPREAD_AWAY`, `OVER_TOTAL`, `UNDER_TOTAL`, `ML_UNDERDOG`, `ML_FAVORITE` |

### 3.2 Category Initialization

```typescript
// Initialize weights for new sports
const NHL_CATEGORIES = [
  { category: 'GOAL_SCORER', side: 'over', weight: 1.0, sport: 'icehockey_nhl' },
  { category: 'PLAYMAKER_ASSISTS', side: 'over', weight: 1.0, sport: 'icehockey_nhl' },
  { category: 'SHOT_VOLUME', side: 'over', weight: 1.0, sport: 'icehockey_nhl' },
  { category: 'GOALIE_SAVES', side: 'over', weight: 1.0, sport: 'icehockey_nhl' },
];

const TEAM_CATEGORIES = [
  { category: 'SHARP_SPREAD', side: 'home', weight: 1.0, sport: 'all_team' },
  { category: 'OVER_TOTAL', side: 'over', weight: 1.0, sport: 'all_team' },
  { category: 'UNDER_TOTAL', side: 'under', weight: 1.0, sport: 'all_team' },
];
```

---

## Phase 4: Data Collection Expansion

### 4.1 Maximize Props Collection

Update the existing 5-minute cron jobs to collect maximum data:

```sql
-- Ensure whale-odds-scraper runs every 5 minutes for all sports
-- This is already configured - verify it's running for:
-- basketball_nba, icehockey_nhl, tennis_atp, tennis_wta
-- americanfootball_nfl (when in season)
```

### 4.2 Target Pool Size

| Sport | Target Active Props | Current |
|-------|---------------------|---------|
| NBA Player Props | 200+ | 186 |
| NHL Player Props | 100+ | 0 (needs activation) |
| Tennis Player Props | 50+ | 0 (needs activation) |
| Team Props (All) | 50+ | 21 |
| **Total Pool** | **500+** | 207 |

---

## Phase 5: Learning Analytics Dashboard

### 5.1 New Dashboard Components

```typescript
// BotLearningAnalytics.tsx - New component
interface LearningMetrics {
  tier: string;
  sampleSize: number;
  winRate: number;
  confidenceInterval: [number, number];
  daysToConvergence: number;
  topCategories: CategoryPerformance[];
  worstCategories: CategoryPerformance[];
}
```

### 5.2 Statistical Confidence Display

```text
┌────────────────────────────────────────────────────────────────┐
│  📊 Learning Velocity                                          │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Exploration Tier (50/day)                                     │
│  ████████████████████░░░░ 80% to statistical confidence        │
│  Current: 412 samples | Need: 500 for 95% CI                   │
│                                                                │
│  Validation Tier (15/day)                                      │
│  ██████████░░░░░░░░░░░░░░ 42% to statistical confidence        │
│  Current: 126 samples | Need: 300 for 95% CI                   │
│                                                                │
│  Execution Tier (8/day)                                        │
│  ████░░░░░░░░░░░░░░░░░░░░ 18% to statistical confidence        │
│  Current: 54 samples | Need: 300 for 95% CI                    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Phase 6: Telegram Bot Updates

### 6.1 New Commands

| Command | Description |
|---------|-------------|
| `/learning` | Show learning velocity and confidence metrics |
| `/tiers` | Summary of all three tiers' performance |
| `/explore` | Today's exploration tier highlights |
| `/validate` | Today's validation tier picks |

### 6.2 Daily Summary Format

```text
🤖 Daily Bot Summary (Feb 8, 2026)

📈 GENERATION
• Exploration: 50 parlays (edge discovery)
• Validation: 15 parlays (pattern confirmation)  
• Execution: 8 parlays (real bets)

🎯 YESTERDAY'S RESULTS
• Exploration: 18/50 (36%) - learned 12 patterns
• Validation: 7/15 (47%) - confirmed 3 categories
• Execution: 4/8 (50%) - +$142 profit

📊 LEARNING VELOCITY
• 82% to statistical confidence (est. 6 days)
• Top emerging: NHL_GOAL_SCORER (72% hit rate)
• Demoting: TEAM_UNDER_TOTAL (38% hit rate)
```

---

## Implementation Sequence

### Week 1: Database + Core Engine
1. Add `tier` column and learning metrics table
2. Add `sport` column to category weights
3. Refactor `bot-generate-daily-parlays` for tiered generation
4. Initialize category weights for NHL and Team props

### Week 2: Multi-Sport Integration
1. Ensure NHL and Tennis data flowing via whale-odds-scraper
2. Create sport-specific category analyzers
3. Add team prop categories and scoring
4. Test cross-sport parlay generation

### Week 3: UI + Telegram
1. Build BotLearningAnalytics component
2. Add tier breakdown to BotDashboard
3. Implement new Telegram commands
4. Create daily tier summary notifications

### Week 4: Optimization + Testing
1. Tune tier thresholds based on initial data
2. Optimize Monte Carlo batch processing
3. Add statistical significance tests
4. Full end-to-end testing

---

## Technical Modifications

### Files to Create
- `src/components/bot/BotLearningAnalytics.tsx`
- `src/components/bot/TierBreakdownCard.tsx`

### Files to Modify
- `supabase/functions/bot-generate-daily-parlays/index.ts` - Major refactor for tiers
- `supabase/functions/bot-settle-and-learn/index.ts` - Sport-aware learning
- `supabase/functions/telegram-webhook/index.ts` - New commands
- `src/pages/BotDashboard.tsx` - Add learning analytics
- `src/hooks/useBotEngine.ts` - Tier-aware state

### Database Migrations
- Add `tier` and `tier_config` to `bot_daily_parlays`
- Create `bot_learning_metrics` table
- Add `sport` column to `bot_category_weights`

---

## Expected Outcomes

| Metric | Current | After Implementation |
|--------|---------|---------------------|
| Daily Parlays | 8-10 | 65-75 |
| Monthly Samples | ~280 | ~2,100 |
| Time to 95% Confidence | 5-6 months | 4-6 weeks |
| Category Coverage | NBA only | NBA + NHL + Tennis + Team |
| Learning Rate | Slow | 7.5x faster |

