

# Autonomous Betting Bot with Self-Learning & Testing

## Overview

Build a complete autonomous betting bot system that:
1. **Generates daily parlays** using Monte Carlo simulation + proven 60%+ categories
2. **Tracks outcomes** in simulation mode (no real money)
3. **Learns from mistakes** by adjusting category weights dynamically
4. **Creates/retires strategies** based on performance
5. **Activates real betting** only after 3 consecutive profitable simulation days

## Current State Analysis

### Existing Infrastructure

| Component | Status | Purpose |
|-----------|--------|---------|
| `useSimulatedParlayBuilder.ts` | ✅ Built | MC simulation with 5K/25K/50K iterations |
| `hybrid-monte-carlo.ts` | ✅ Built | Cholesky correlation + parametric screening |
| `useSweetSpotParlayBuilder.ts` | ✅ Built | Rule-based scoring with pattern matching |
| `SimulationCard.tsx` | ✅ Built | UI for simulation results |
| Bot tracking tables | ❌ Missing | Need bot_daily_parlays, bot_strategies, etc. |
| Bot edge functions | ❌ Missing | Need generate/settle/learn functions |
| Bot tests | ❌ Missing | Unit + integration tests |

### Proven Category Performance (From Memory)

| Category | Hit Rate | Status |
|----------|----------|--------|
| HIGH_ASSIST_UNDER | 69.2% | **ELITE** - Bot approved |
| LOW_SCORER_UNDER | 66.0% | **ELITE** - Bot approved |
| THREE_POINT_SHOOTER | 63.2% | **ELITE** - Bot approved |
| BIG_ASSIST_OVER | 59.0% | **RELIABLE** - Bot approved |
| ROLE_PLAYER_REB | 48.2% | **BLOCKED** - Below 55% |
| HIGH_ASSIST (OVER) | 33.3% | **BLOCKED** - Major loser |

## Implementation Plan

### Phase 1: Database Schema

#### 1.1 Create `bot_daily_parlays` Table

Stores each day's generated parlays with full traceability:

```sql
CREATE TABLE bot_daily_parlays (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  parlay_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Parlay Details
  legs jsonb NOT NULL,
  leg_count int NOT NULL,
  combined_probability numeric NOT NULL,
  expected_odds int NOT NULL,
  simulated_win_rate numeric,
  simulated_edge numeric,
  simulated_sharpe numeric,
  
  -- Strategy Used
  strategy_name text NOT NULL,
  strategy_version int DEFAULT 1,
  category_weights_snapshot jsonb,
  selection_rationale text,
  
  -- Outcome Tracking  
  outcome text DEFAULT 'pending' CHECK (outcome IN ('pending', 'won', 'lost', 'partial', 'push')),
  legs_hit int DEFAULT 0,
  legs_missed int DEFAULT 0,
  settled_at timestamptz,
  
  -- Learning Feedback
  profit_loss numeric,
  lesson_learned text,
  
  -- Mode Tracking
  is_simulated boolean DEFAULT true,
  simulated_stake numeric DEFAULT 50,
  simulated_payout numeric
);
```

#### 1.2 Create `bot_category_weights` Table

Dynamic category performance weights that adjust based on outcomes:

```sql
CREATE TABLE bot_category_weights (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text UNIQUE NOT NULL,
  side text NOT NULL,
  
  -- Performance Metrics
  total_picks int DEFAULT 0,
  total_hits int DEFAULT 0,
  current_hit_rate numeric DEFAULT 0,
  
  -- Dynamic Weight (0.5-1.5 range)
  weight numeric DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1.5),
  is_blocked boolean DEFAULT false,
  block_reason text,
  
  -- Streaks
  current_streak int DEFAULT 0,
  best_streak int DEFAULT 0,
  worst_streak int DEFAULT 0,
  
  updated_at timestamptz DEFAULT now()
);
```

#### 1.3 Create `bot_strategies` Table

Versioned strategy rules with performance tracking:

```sql
CREATE TABLE bot_strategies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  
  -- Strategy Rules
  rules jsonb NOT NULL,
  
  -- Performance
  times_used int DEFAULT 0,
  times_won int DEFAULT 0,
  win_rate numeric DEFAULT 0,
  roi numeric DEFAULT 0,
  
  -- Status
  is_active boolean DEFAULT true,
  retired_at timestamptz,
  retire_reason text,
  
  -- Auto-evolution
  auto_generated boolean DEFAULT false,
  parent_strategy text
);
```

#### 1.4 Create `bot_activation_status` Table

Track readiness for real betting (3-day requirement):

```sql
CREATE TABLE bot_activation_status (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  check_date date UNIQUE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Daily Performance
  parlays_generated int DEFAULT 0,
  parlays_won int DEFAULT 0,
  daily_profit_loss numeric DEFAULT 0,
  is_profitable_day boolean DEFAULT false,
  
  -- Streak Tracking
  consecutive_profitable_days int DEFAULT 0,
  
  -- Activation Status
  is_real_mode_ready boolean DEFAULT false,
  activated_at timestamptz,
  
  -- Bankroll
  simulated_bankroll numeric DEFAULT 1000,
  real_bankroll numeric DEFAULT 0
);
```

### Phase 2: Core Bot Hook

#### 2.1 Create `useBotEngine.ts`

Central hook that manages the entire bot lifecycle:

```typescript
// Key exports
export interface BotState {
  isActive: boolean;
  mode: 'simulated' | 'real';
  consecutiveProfitDays: number;
  simulatedBankroll: number;
  todayParlays: BotParlay[];
  categoryWeights: Map<string, CategoryWeight>;
  activeStrategy: BotStrategy;
}

export interface BotParlay {
  id: string;
  legs: BotLeg[];
  simulation: HybridSimulationResult;
  outcome: 'pending' | 'won' | 'lost' | 'partial';
  stake: number;
}

export function useBotEngine(): {
  state: BotState;
  generateDailyParlays: () => Promise<BotParlay[]>;
  settleYesterdayParlays: () => Promise<void>;
  learnFromOutcomes: () => Promise<void>;
  checkActivation: () => boolean;
}
```

#### 2.2 Learning Algorithm

Weight adjustment rules hardcoded into the bot:

```typescript
function adjustCategoryWeight(
  currentWeight: number,
  hit: boolean,
  currentStreak: number
): { newWeight: number; blocked: boolean } {
  if (hit) {
    // Boost on hits, more boost for streaks
    const boost = 0.02 + (Math.max(0, currentStreak) * 0.005);
    return {
      newWeight: Math.min(currentWeight + boost, 1.5),
      blocked: false
    };
  } else {
    // Penalty on misses
    const penalty = 0.03 + (Math.abs(Math.min(0, currentStreak)) * 0.01);
    const newWeight = currentWeight - penalty;
    
    // Auto-block if weight drops below 0.5
    if (newWeight < 0.5) {
      return { newWeight: 0, blocked: true };
    }
    return { newWeight: Math.max(newWeight, 0.5), blocked: false };
  }
}
```

### Phase 3: Edge Functions

#### 3.1 Create `bot-generate-daily-parlays`

Runs daily at 9 AM ET:

```text
Logic Flow:
1. Load current category weights from bot_category_weights
2. Fetch today's picks from category_sweet_spots
3. Filter to 60%+ hit rate categories AND weight >= 0.8
4. Run MC simulation on top combinations (25K iterations)
5. Select parlays that pass viability thresholds:
   - Win probability >= 12%
   - Edge >= 3%
   - Sharpe >= 0.5
6. Save 2-3 parlays to bot_daily_parlays
7. Update bot_activation_status
```

#### 3.2 Create `bot-settle-and-learn`

Runs daily at 6 AM ET:

```text
Logic Flow:
1. Get yesterday's bot_daily_parlays with outcome='pending'
2. For each parlay:
   - Check each leg against nba_player_game_logs
   - Calculate hit/miss for each leg
   - Determine overall outcome
3. For each settled leg:
   - Update bot_category_weights (weight adjustment)
   - Track streaks
   - Auto-block if weight < 0.5
4. Calculate daily profit/loss
5. Update bot_activation_status:
   - If profitable: consecutive_days++
   - If loss: consecutive_days = 0
6. Check activation: If 3+ consecutive profitable days → ready for real mode
```

#### 3.3 Create `bot-evolve-strategies`

Runs weekly (Sunday 11 PM ET):

```text
Logic Flow:
1. Get strategies with 20+ uses
2. For each strategy:
   - If win_rate < 40%: RETIRE and create mutated version
   - If win_rate >= 65%: BOOST priority
3. Analyze winning patterns from last 7 days
4. Auto-generate new strategies from patterns
5. Log evolution decisions to bot_strategies
```

### Phase 4: Bot Dashboard UI

#### 4.1 Create `/bot` Route

New page at `src/pages/BotDashboard.tsx`:

```text
Sections:
1. ACTIVATION PROGRESS
   - "Day 2 of 3" progress ring
   - Simulated bankroll display
   - Real mode activation countdown

2. TODAY'S BOT PARLAYS
   - Cards showing 2-3 generated parlays
   - MC simulation metrics (win rate, edge, Sharpe)
   - Leg details with category weights

3. CATEGORY WEIGHTS (Live)
   - Visual bars (0.5-1.5 range)
   - Red = blocked, Yellow = caution, Green = boosted
   - Click to see learning history

4. LEARNING LOG
   - Recent weight adjustments
   - Strategy changes
   - Block/unblock events

5. HISTORICAL PERFORMANCE
   - Simulated bankroll chart
   - Win rate by strategy
   - ROI by category
```

#### 4.2 UI Components

| Component | Purpose |
|-----------|---------|
| `BotActivationCard.tsx` | 3-day progress ring + activation status |
| `BotParlayCard.tsx` | Individual parlay with simulation metrics |
| `CategoryWeightsChart.tsx` | Live category weight visualization |
| `LearningLogCard.tsx` | Real-time learning actions feed |
| `BotPerformanceChart.tsx` | Bankroll growth + win rate chart |

### Phase 5: Testing Suite

#### 5.1 Unit Tests for Bot Engine

Create `src/hooks/useBotEngine.test.ts`:

```typescript
describe('Bot Engine - Weight Adjustment', () => {
  it('increases weight on hit', () => {
    const result = adjustCategoryWeight(1.0, true, 0);
    expect(result.newWeight).toBeGreaterThan(1.0);
  });
  
  it('decreases weight on miss', () => {
    const result = adjustCategoryWeight(1.0, false, 0);
    expect(result.newWeight).toBeLessThan(1.0);
  });
  
  it('blocks category when weight drops below 0.5', () => {
    const result = adjustCategoryWeight(0.52, false, -3);
    expect(result.blocked).toBe(true);
  });
  
  it('caps weight at 1.5 maximum', () => {
    const result = adjustCategoryWeight(1.48, true, 5);
    expect(result.newWeight).toBe(1.5);
  });
});

describe('Bot Engine - Category Filtering', () => {
  it('blocks categories below 55% hit rate', () => {
    const categories = filterEligibleCategories([
      { category: 'HIGH_ASSIST_UNDER', hitRate: 69, weight: 1.0 },
      { category: 'ROLE_PLAYER_REB', hitRate: 48, weight: 1.0 },
    ]);
    expect(categories.length).toBe(1);
    expect(categories[0].category).toBe('HIGH_ASSIST_UNDER');
  });
  
  it('blocks categories with weight < 0.8', () => {
    const categories = filterEligibleCategories([
      { category: 'HIGH_ASSIST_UNDER', hitRate: 69, weight: 1.0 },
      { category: 'BIG_ASSIST_OVER', hitRate: 60, weight: 0.6 },
    ]);
    expect(categories.length).toBe(1);
  });
});

describe('Bot Engine - Activation Logic', () => {
  it('requires 3 consecutive profitable days', () => {
    expect(checkActivation({ consecutiveDays: 2, totalParlays: 10, winRate: 0.65 })).toBe(false);
    expect(checkActivation({ consecutiveDays: 3, totalParlays: 10, winRate: 0.65 })).toBe(true);
  });
  
  it('requires 60%+ overall win rate', () => {
    expect(checkActivation({ consecutiveDays: 3, totalParlays: 10, winRate: 0.55 })).toBe(false);
  });
  
  it('requires minimum 5 parlays generated', () => {
    expect(checkActivation({ consecutiveDays: 3, totalParlays: 3, winRate: 0.65 })).toBe(false);
  });
});
```

#### 5.2 Integration Tests for Simulation

Create `src/hooks/useBotSimulation.test.ts`:

```typescript
describe('Bot Simulation Integration', () => {
  it('generates viable parlays from proven categories', async () => {
    const candidates = createMockCandidates([
      { category: 'HIGH_ASSIST_UNDER', hitRate: 70 },
      { category: 'LOW_SCORER_UNDER', hitRate: 66 },
      { category: 'THREE_POINT_SHOOTER', hitRate: 63 },
      { category: 'BIG_ASSIST_OVER', hitRate: 59 },
    ]);
    
    const result = await generateBotParlay(candidates, 4);
    
    expect(result.simulation.hybridWinRate).toBeGreaterThan(0.10);
    expect(result.simulation.overallEdge).toBeGreaterThan(0);
  });
  
  it('rejects parlays with negative edge', async () => {
    const candidates = createMockCandidates([
      { category: 'ROLE_PLAYER_REB', hitRate: 48 }, // Below threshold
    ]);
    
    const result = await generateBotParlay(candidates, 4);
    
    expect(result).toBeNull();
  });
});
```

#### 5.3 Edge Function Tests

Create `supabase/functions/bot-generate-daily-parlays/index_test.ts`:

```typescript
import "https://deno.land/std@0.224.0/dotenv/load.ts";

Deno.test("generates parlays for valid date", async () => {
  const response = await fetch(
    `${Deno.env.get("VITE_SUPABASE_URL")}/functions/v1/bot-generate-daily-parlays`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")}`,
      },
      body: JSON.stringify({ date: "2026-02-08" }),
    }
  );
  
  const data = await response.json();
  await response.text(); // Consume body
  
  assertEquals(response.status, 200);
  assertEquals(data.parlaysGenerated >= 0, true);
});
```

### Phase 6: Cron Jobs

| Time (ET) | Function | Purpose |
|-----------|----------|---------|
| 9:00 AM | `bot-generate-daily-parlays` | Generate today's picks |
| 6:00 AM | `bot-settle-and-learn` | Settle yesterday + learn |
| 11:00 PM (Sun) | `bot-evolve-strategies` | Weekly strategy evolution |

### File Changes Summary

#### New Files

| File | Purpose |
|------|---------|
| `src/hooks/useBotEngine.ts` | Core bot logic hook |
| `src/hooks/useBotEngine.test.ts` | Unit tests for bot engine |
| `src/hooks/useBotSimulation.test.ts` | Integration tests |
| `src/pages/BotDashboard.tsx` | Bot dashboard page |
| `src/components/bot/BotActivationCard.tsx` | Activation progress UI |
| `src/components/bot/BotParlayCard.tsx` | Individual parlay display |
| `src/components/bot/CategoryWeightsChart.tsx` | Weight visualization |
| `src/components/bot/LearningLogCard.tsx` | Learning actions feed |
| `src/components/bot/BotPerformanceChart.tsx` | Performance charts |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Daily generation |
| `supabase/functions/bot-settle-and-learn/index.ts` | Settlement + learning |
| `supabase/functions/bot-evolve-strategies/index.ts` | Strategy evolution |
| `supabase/functions/bot-generate-daily-parlays/index_test.ts` | Edge function tests |

#### Modified Files

| File | Change |
|------|--------|
| `src/App.tsx` | Add `/bot` route |
| `src/components/BottomNav.tsx` | Add Bot tab |
| `supabase/config.toml` | Add new edge functions |

### Expert Betting Rules (Hardcoded in Bot)

1. **Category Gate**: ONLY bet categories with 55%+ verified hit rate
2. **Weight Gate**: ONLY use categories with weight >= 0.8
3. **Edge Gate**: Minimum 2.0+ edge for any pick
4. **Simulation Gate**: Must pass MC validation (12%+ win rate, 3%+ edge)
5. **Diversity Gate**: Max 1 player per team
6. **Stake Gate**: Half-Kelly sizing, max 3% per bet in real mode
7. **Volume Gate**: 2-3 parlays per day maximum
8. **Activation Gate**: 3 consecutive profitable simulation days required

### Expected Flow

```text
Day 1 (Simulation):
  9 AM: Bot generates 3 parlays using MC simulation
  6 PM: Games settle
  
Day 2 (6 AM):
  Bot settles Day 1 parlays
  2 won, 1 lost → Profitable day (+$80)
  Updates category weights (HIGH_ASSIST_UNDER: 1.0 → 1.02)
  consecutive_profitable_days = 1

Day 2 (9 AM):
  Bot generates 3 new parlays with updated weights
  ...

Day 4 (6 AM):
  consecutive_profitable_days = 3
  ✅ REAL MODE ACTIVATED
  Bot starts placing real bets with Kelly sizing
```

