

# Monte Carlo Simulation Integration for Parlay Generation

## Current State Analysis

### Existing Assets

| Component | Status | Purpose |
|-----------|--------|---------|
| `src/lib/hybrid-monte-carlo.ts` | ✅ Built | 50,000 iteration MC simulation with Cholesky correlation |
| `runHybridSimulation()` | ✅ Ready | Returns win probability, edge, Kelly fraction, Sharpe ratio |
| `useSweetSpotParlayBuilder.ts` | ✅ Active | Builds 6-leg parlays using pattern scoring |
| Integration | ❌ Missing | **MC engine not connected to parlay builder** |

### The Gap

Your parlay builder uses **rule-based scoring** (L10 hit rate, pattern matching, synergy) but doesn't run the actual probability simulation before recommending picks. This means:
- Combined probability is estimated, not simulated
- Leg correlations are scored but not mathematically modeled
- No variance/risk metrics shown to user

## Solution: Add Simulation-Validated Parlay Generation

### Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                SIMULATION-VALIDATED PARLAY FLOW                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Step 1: CANDIDATE GENERATION                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ useSweetSpotParlayBuilder                                 │   │
│  │ • Category filtering (60%+ hit rate only)                 │   │
│  │ • Edge thresholds (4.5+ points, 2.5+ rebounds)            │   │
│  │ • Synergy scoring (same-game correlation)                 │   │
│  │ • Output: Top 20 candidate picks                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                             │                                    │
│                             ▼                                    │
│  Step 2: COMBINATION SIMULATION                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ runHybridSimulation() x N combinations                    │   │
│  │ • Generate all 6-leg combinations from top 20             │   │
│  │ • Run 10,000 iterations per combination                   │   │
│  │ • Apply Cholesky correlation (same-game boost)            │   │
│  │ • Calculate: win rate, edge, Sharpe, Kelly                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                             │                                    │
│                             ▼                                    │
│  Step 3: OPTIMAL SELECTION                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Select parlay with:                                       │   │
│  │ • Highest simulation win rate (not just rule score)       │   │
│  │ • Positive expected value (EV > 0)                        │   │
│  │ • Best Sharpe ratio (reward-to-risk)                      │   │
│  │ • Kelly fraction > 1% (bankroll-worthy)                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Plan

#### 1. Create Simulation Wrapper Hook

**New File:** `src/hooks/useSimulatedParlayBuilder.ts`

Wraps the existing builder and adds MC validation:

```typescript
// Key function signature
function buildSimulatedParlay(
  candidates: SweetSpotPick[],
  config: {
    legCount: 4 | 5 | 6;
    iterations: 10000 | 25000 | 50000;
    minWinRate: 0.15;  // 15% minimum
    minEdge: 0.03;     // 3% minimum
  }
): SimulatedParlayResult {
  // 1. Generate top candidate combinations
  const combinations = generateCombinations(candidates, legCount);
  
  // 2. Simulate each combination
  const results = combinations.map(combo => 
    runHybridSimulation(convertToLegInputs(combo), { iterations })
  );
  
  // 3. Filter to viable parlays only
  const viable = results.filter(r => 
    r.hybridWinRate >= minWinRate && 
    r.overallEdge >= minEdge
  );
  
  // 4. Select best by Sharpe ratio
  return viable.sort((a, b) => b.sharpeRatio - a.sharpeRatio)[0];
}
```

#### 2. Add Simulation Results to UI

**Modify:** `src/pages/SweetSpots.tsx`

Display simulation metrics alongside picks:

```text
Current: "Optimal 6-Leg: 62% avg confidence"

After: "Optimal 6-Leg: 18.4% simulated win rate • 8.2% edge • 1.3 Sharpe"
       "Simulated 38,760 combinations • Best of 847 viable parlays"
```

#### 3. Add "Run Simulation" Button

Allow users to trigger deeper simulation:

```text
┌────────────────────────────────────────┐
│ 🎲 Simulation Analysis                  │
├────────────────────────────────────────┤
│ [Quick (10K)]  [Standard (25K)]  [Deep (50K)] │
│                                        │
│ Results:                               │
│ • Win Probability: 18.4%               │
│ • Edge vs Implied: +8.2%               │
│ • Sharpe Ratio: 1.32                   │
│ • Kelly Stake: 2.1% of bankroll        │
│ • Confidence: 94% (based on variance)  │
│                                        │
│ Recommendation: ✅ STRONG BET          │
└────────────────────────────────────────┘
```

#### 4. Bot Integration

Connect to the autonomous bot for daily parlay generation:

```typescript
// In bot-generate-daily-parlays edge function
const candidates = await getCategoryPicks(); // 60%+ categories only
const simResult = runHybridSimulation(
  convertToLegInputs(candidates.slice(0, 6)),
  { iterations: 50000, useCorrelations: true }
);

// Only generate parlay if simulation passes
if (simResult.recommendation === 'strong_bet' || 
    simResult.recommendation === 'value_bet') {
  await saveBotParlay(candidates, simResult);
}
```

## Technical Details

### File Changes

| File | Change |
|------|--------|
| `src/hooks/useSimulatedParlayBuilder.ts` | **NEW** - MC-validated parlay builder |
| `src/components/sweetspots/SimulationCard.tsx` | **NEW** - Display simulation results |
| `src/hooks/useSweetSpotParlayBuilder.ts` | Add simulation integration |
| `src/pages/SweetSpots.tsx` | Add simulation UI section |
| `src/lib/hybrid-monte-carlo.ts` | Add batch simulation helper |

### Performance Optimization

Running 50,000 iterations for hundreds of combinations would be slow. Optimization strategy:

```text
1. QUICK FILTER (no simulation)
   - Rule-based scoring reduces 100+ picks to top 20
   
2. LIMITED COMBINATIONS
   - Instead of C(20,6) = 38,760 combinations
   - Use greedy selection: pick best, then best compatible, etc.
   - Reduces to ~50-100 combinations to simulate
   
3. ADAPTIVE ITERATIONS
   - Quick mode: 5,000 iterations (for browsing)
   - Standard: 25,000 (for daily picks)
   - Deep: 50,000 (for bot/real money)
   
4. WEB WORKER
   - Run simulation in background thread
   - Show loading state while computing
```

### Simulation Metrics Explained

| Metric | Description | Target |
|--------|-------------|--------|
| Win Rate | % of iterations where all legs hit | >15% for 6-leg |
| Edge | Win rate minus implied probability | >5% |
| Sharpe Ratio | Return per unit of risk | >1.0 |
| Kelly Fraction | Optimal bet size | 1-3% |
| Confidence | Based on variance of simulation | >80% |

### OpticOdds Alternative

Since OpticOdds requires paid enterprise access, continue using:
- **The Odds API** (already integrated) for DraftKings/FanDuel lines
- **Manual verification** that Hard Rock lines match (usually within 0.5)
- **Category accuracy data** from your own database (most valuable)

Your 30-day category hit rates (HIGH_ASSIST_UNDER 69%, LOW_SCORER_UNDER 66%) are more predictive than any odds source.

## Expected Outcome

After this integration:

1. **Every parlay recommendation is simulation-validated**
   - Not just rule scores, but actual Monte Carlo probability

2. **Users see real risk metrics**
   - Win probability, edge, Sharpe ratio, Kelly stake

3. **Bot uses simulation for daily picks**
   - Only generates parlays that pass MC validation

4. **Historical tracking improves**
   - Compare simulated vs actual outcomes
   - Calibrate model over time

## Accuracy Improvement Path

```text
Week 1: Integrate MC simulation
Week 2: Track simulated vs actual outcomes  
Week 3: Calibrate correlation factors
Week 4: A/B test MC picks vs rule-only picks
Week 5+: Continuous learning from results
```

The simulation doesn't guarantee 100% accuracy - that's impossible in sports betting. But it provides **mathematically sound probability estimates** rather than rule-based guesses.

