

## Environment-Clustered Parlay Assembly — "Ride the Same Wave"

### The Problem

Your current stacking logic is too weak to meaningfully cluster legs by game environment:

- `pickCoherenceBonus` only gives tiny +2/-2 adjustments for pace alignment
- The coherence gate (min 60-70) only rejects obvious contradictions
- Legs are primarily sorted by composite score, so a high-scoring pick against a tough defense gets mixed with a high-scoring pick against a weak defense
- Result: parlays contain a mix of environments (fast-pace + slow-pace, soft defense + tough defense), diluting the narrative

### The Fix: Environment Cluster Stacking

Instead of assembling parlays leg-by-leg from a single sorted pool, **pre-cluster picks by game environment** and build parlays within each cluster. This ensures every leg in a parlay is riding the same environmental wave.

### Architecture

```text
All Enriched Picks
       |
  Environment Classifier
       |
  +----+----+----+----+
  |         |         |
SHOOTOUT  GRIND    NEUTRAL
(fast pace (slow pace
 soft def   tough def
 high total low total)
 game OVER)
       |         |
  Build parlays  Build parlays
  ALL OVER legs  ALL UNDER legs
  soft defense   tough defense
```

### Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

**1. New Environment Cluster System**

Add a function that classifies each pick into an environment cluster based on its `_gameContext`:

- **SHOOTOUT cluster**: pace = fast OR defense = soft OR vegas total >= 225 OR team total signal = OVER. These picks get assembled into OVER-heavy parlays.
- **GRIND cluster**: pace = slow OR defense = tough OR vegas total <= 210 OR team total signal = UNDER. These picks get assembled into UNDER-heavy parlays.
- **NEUTRAL cluster**: everything else — assembled normally.

Each pick gets tagged with its cluster. Picks that strongly match a cluster (2+ signals) get priority within that cluster.

**2. Cluster-First Parlay Assembly**

Before the main parlay generation loop, add a new "clustered" generation pass for the **execution tier**:

- For each environment cluster with 3+ picks, build parlays exclusively from that cluster
- Within a cluster, picks are sorted by composite score (same as now) but the coherence bonus is amplified to **10x** (from 3x) since all picks should naturally align
- These clustered parlays get a **+10 coherence bonus** on top of the normal calculation
- Clustered parlays are labeled with their environment (e.g., `execution_shootout_stack`, `execution_grind_stack`)

**3. Strengthen pickCoherenceBonus**

Increase the coherence bonuses from +2/-2 to much more impactful values:

| Signal | Current | New |
|--------|---------|-----|
| Both OVER + both fast pace | +2 | +8 |
| Both OVER + both soft defense | (none) | +8 |
| Both UNDER + both tough defense | (none) | +8 |
| Both UNDER + both slow pace | +2 | +8 |
| OVER in slow pace mixed with UNDER in fast pace | -2 | -10 |
| Same-game environment cluster match | (none) | +6 |
| Mixed cluster (shootout + grind) | (none) | -8 |

**4. Raise Coherence Gate for Execution Tier**

- Execution tier minimum: 70 (current) raised to **85**
- Validation tier minimum: 60 (current) raised to **70**
- Exploration tier: keep at 60 (allows data collection)

**5. Defense-Strength Matching During Selection**

Add a new check in the leg selection loop: when adding leg 2+, if all existing legs face **soft defense** (rank 20-30), penalize candidates facing **tough defense** (rank 1-10) by -15, and vice versa. This creates natural clustering without rigid cluster boundaries.

### Expected Impact

- Parlays become **thematically coherent**: all legs benefit from the same game script
- OVER parlays only contain legs against weak defenses in fast-paced, high-total games
- UNDER parlays only contain legs against tough defenses in slow-paced, low-total games
- Eliminates the "1 leg kills the parlay because it was in a grind game" scenario
- The coherence gate raise ensures only well-stacked parlays reach execution tier

### Parlay Volume Consideration

Clustering will reduce the candidate pool per parlay, so:
- If a cluster has fewer than 3 picks, its picks fall back to the normal (unclustered) assembly
- The normal assembly still runs after clustered parlays, ensuring volume targets are met
- Clustered parlays are generated **first** (best quality), then normal parlays fill remaining volume
