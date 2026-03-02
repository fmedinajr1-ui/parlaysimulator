

# Fix Mega Jackpot First Basket Bug + Fine-Tune Lottery Selection

## The Bug

The `hasCorrelatedProp` function (line 40-78) blocks same-player duplicates and same-game team bet stacking, but does NOT block multiple `player_first_basket` props from the same game. Since `MAX_SAME_PROP = 2` and `MAX_PER_GAME = 2`, two first-basket picks from the same game (e.g., Jokic + Murray) slip through -- but only ONE player can score the first basket, so this parlay is mathematically dead on arrival.

## How Lottery Selection Currently Works

The scanner builds 3 tiered tickets from scored NBA props:

1. **Standard** (+500 to +2000, $5 stake): 2-4 legs, player props only, strict filters (70%+ hit rate safe leg, 60%+ balanced, 55%+ great odds)
2. **High Roller** (up to +8000, $3 stake): 3-6 legs, allows 1 exotic, per-leg cap +500, 35%+ hit rate
3. **Mega Jackpot** (+10,000 to +50,000, $1 stake): 4-8 legs, round-robin from 3 pools (exotic/team bet/player prop), max 2 exotic, max 2 team bets, max 4 player props

Each prop gets a composite score from: hit rate (35%), edge (20%), median gap (10%), direction bonus, defense matchup bonus, hot streak bonus, odds value, and volume candidate flag.

## The Fix (Change 1): Block Same-Game First Basket

**File:** `supabase/functions/nba-mega-parlay-scanner/index.ts`

In `hasCorrelatedProp` (after line 56, before the player-level checks), add:

```text
// Block multiple first basket props from same game (mutually exclusive)
if (normalizePropType(candidateProp) === 'player_first_basket' && candidateEventId) {
  const sameGameFB = existingLegs.filter(
    l => normalizePropType(l.prop_type) === 'player_first_basket' 
      && l.event_id === candidateEventId
  );
  if (sameGameFB.length > 0) return true;
}
```

This applies to all 3 ticket tiers since they all flow through `passesBasicChecks` which calls `hasCorrelatedProp`.

## Fine-Tuning (Change 2): Smarter Exotic Selection

Currently exotic players get a flat baseline hit rate (first basket = 8%, double-double = 40%). This means a bench player's first basket scores the same as a star's. Add a star-player bonus:

- If the player has a sweet spot entry with high confidence, boost composite score by +10
- If the player averages 20+ points (from L10 data), boost first basket score by +5 (starters more likely to get first bucket)

**In the scoring loop (around line 604-609)**, after the baseline exotic hit rate assignment:

```text
// Star player bonus for first basket
if (prop.prop_type === 'player_first_basket') {
  const playerL10 = gameLogMap.get(`${nameNorm}|points`);
  if (playerL10?.l10_avg && playerL10.l10_avg >= 20) {
    hitRate += 4; // Stars more likely to score first
  }
  if (playerL10?.l10_avg && playerL10.l10_avg >= 28) {
    hitRate += 4; // Elite scorers even more likely
  }
}
```

## Fine-Tuning (Change 3): L10 Stability Check for Mega Jackpot

Currently the Mega Jackpot only checks if L10 avg clears `line * 0.7` -- very loose. Tighten for player props to reduce variance:

**In mega candidate filter (line 1036-1039)**, change the L10 floor from `0.7` to `0.85`:

```text
if (bestAvg !== null && bestAvg < p.line * 0.85) return false;
```

This filters out players who are significantly underperforming relative to their line, reducing "hope picks."

## Fine-Tuning (Change 4): Prefer Different Games in Mega Jackpot

The current `MAX_PER_GAME = 2` allows 2 legs from the same game in a lottery ticket. For the Mega Jackpot specifically, correlated outcomes from the same game increase variance. Lower the per-game cap to 1 for the Mega tier by adding a check in the round-robin builder.

**In the mega round-robin loops (lines 1075-1101)**, add before `passesBasicChecks`:

```text
// Mega Jackpot: prefer game diversity (max 1 per game)
if (gc.get(c.game) && gc.get(c.game)! >= 1) continue;
```

## Deployment Steps

1. Apply all 4 changes to `nba-mega-parlay-scanner/index.ts`
2. Deploy the edge function
3. Invoke with `force: true` to void today's existing lottery tickets and regenerate with the fixes

## Expected Results

- No more mathematically impossible first-basket combos
- Star players prioritized for first basket picks over bench players
- Tighter L10 stability reduces low-quality filler legs
- Game diversity in Mega Jackpot reduces correlated blow-ups

