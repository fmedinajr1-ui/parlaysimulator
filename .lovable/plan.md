

# Wire Injury & Defensive Matchup Data Into Monte Carlo Simulations

## The Problem

The Monte Carlo simulation engine already has a `ContextualFactors` system that supports injury impact, defensive ratings, fatigue, pace, and more — but **nothing actually feeds real data into it**. The `convertToLegInput` function hardcodes `context: undefined`, so every simulation runs on raw implied probability alone, ignoring critical real-world signals.

This means a player prop OVER against the #1 defense, or a leg on an injured player, gets the same simulated probability as a clean matchup — producing unrealistic win rates.

## What We'll Fix

### 1. Wire SweetSpotPick data into ContextualFactors

The `SweetSpotPick` type already carries `injuryStatus`, `matchupAdjustment`, and `paceAdjustment`. We'll map these into the `ContextualFactors` that the parametric model already consumes.

**File**: `src/hooks/useSimulatedParlayBuilder.ts`

- Update `convertToLegInput` to build a real `context` object from the pick's existing fields
- Map `injuryStatus` to `injuryImpact` (-0.15 for QUESTIONABLE, -0.30 for DOUBTFUL, block OUT entirely)
- Map `matchupAdjustment` to `defenseRating` (convert from boost/penalty to a multiplier)
- Pass through `paceAdjustment` directly

### 2. Enrich BotEngine MC validation with fatigue + defense data

The bot engine (`useBotEngine.ts`) also runs MC validation but doesn't pass context. We'll update its leg conversion to pull fatigue and matchup data from the `BotLeg` fields.

**File**: `src/hooks/useBotEngine.ts`

- Update the leg-to-simulation conversion to include contextual factors
- Map `hit_rate` trends to `recentForm`
- Use available team/matchup metadata for defense rating

### 3. Add injury and defense fields to ParlayLeg for the comparison simulator

The basic `monte-carlo.ts` simulation (used in the Compare tool) also ignores context. We'll extend `ParlayLeg` with optional context and use it in `calculateAdjustedProbability`.

**File**: `src/types/parlay.ts` and `src/lib/monte-carlo.ts`

- Add optional `contextualFactors` to `ParlayLeg`
- In `calculateAdjustedProbability`, apply defense and injury penalties/boosts on top of the existing upset factor logic

## Technical Details

### convertToLegInput fix (useSimulatedParlayBuilder.ts)

```typescript
function convertToLegInput(pick: SweetSpotPick): ParlayLegInput {
  const baseOdds = pick.side === 'over' ? -110 : -110;

  // Build context from real data on the pick
  const context: ContextualFactors = {};

  // Injury impact: scale from status
  if (pick.injuryStatus) {
    const status = pick.injuryStatus.toUpperCase();
    if (status === 'QUESTIONABLE') context.injuryImpact = -0.08;
    else if (status === 'DOUBTFUL') context.injuryImpact = -0.20;
    else if (status === 'GTD' || status === 'DAY-TO-DAY') context.injuryImpact = -0.10;
    // OUT players should be filtered before reaching simulation
  }

  // Matchup adjustment -> defense rating
  // matchupAdjustment is a boost/penalty value (e.g., +5 = favorable, -5 = tough)
  if (pick.matchupAdjustment != null) {
    // Convert: positive matchup = weak defense (rating < 1), negative = strong defense (rating > 1)
    context.defenseRating = 1 - (pick.matchupAdjustment / 100);
  }

  // Pace adjustment (already a multiplier-like value)
  if (pick.paceAdjustment != null) {
    context.paceAdjustment = 1 + (pick.paceAdjustment / 100);
  }

  // Recent form from hit rate
  if (pick.l10HitRate != null) {
    // L10 hit rate of 70% = hot (1.1x), 40% = cold (0.9x)
    context.recentForm = 0.7 + (pick.l10HitRate / 100) * 0.4;
  }

  const hasContext = Object.keys(context).length > 0;

  return {
    id: pick.id,
    propType: pick.prop_type,
    playerName: pick.player_name,
    teamName: pick.team_name,
    line: pick.line,
    side: pick.side as 'over' | 'under',
    americanOdds: baseOdds,
    expectedValue: pick.projectedValue || pick.line,
    sport: 'basketball',
    gameId: pick.event_id,
    context: hasContext ? context : undefined,
  };
}
```

### ParlayLeg context extension (monte-carlo.ts)

```typescript
// In calculateAdjustedProbability, after existing upset logic:
if (leg.contextualFactors) {
  const ctx = leg.contextualFactors;
  
  // Injury penalty
  if (ctx.injuryImpact) {
    adjustedProb += ctx.injuryImpact; // Negative = reduces probability
  }
  
  // Defense rating: >1 = strong defense (reduces over prob)
  if (ctx.defenseRating && ctx.defenseRating > 1.05) {
    adjustedProb *= (2 - ctx.defenseRating); // 1.1 defense = 0.9x multiplier
  } else if (ctx.defenseRating && ctx.defenseRating < 0.95) {
    adjustedProb *= (2 - ctx.defenseRating); // 0.9 defense = 1.1x multiplier
  }
  
  // Fatigue (back-to-back)
  if (ctx.isBackToBack) {
    adjustedProb *= 0.94; // 6% penalty
  }
  
  // Pace adjustment
  if (ctx.paceAdjustment) {
    adjustedProb *= ctx.paceAdjustment;
  }
}
```

### BotEngine MC enrichment (useBotEngine.ts)

```typescript
// When converting BotLeg to ParlayLegInput for validation:
context: {
  recentForm: leg.hit_rate > 0.6 ? 1.1 : leg.hit_rate < 0.4 ? 0.85 : 1.0,
  // Additional fields if available from the parlay metadata
}
```

## Expected Impact

- Simulated win rates will reflect real matchup difficulty (tough defense = lower sim probability for OVERs)
- Injured/questionable players get realistic probability haircuts instead of being treated as fully healthy
- Fatigue and pace data that the system already collects will finally influence the mathematical validation
- The "Strong Bet" recommendation becomes more trustworthy because the underlying probabilities account for real-world conditions

