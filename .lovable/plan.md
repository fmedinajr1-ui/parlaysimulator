

## Available Engines to Find More Picks Within Today's Matchup Teams

You already ran the **Defense Scanner** and pulled props from `unified_props`. Here are **7 more engines** that can surface additional picks specifically for your locked matchup teams (ATL@MIL, POR@MEM, UTA@PHI):

### Engines to Run (in recommended order)

**1. `matchup-intelligence-analyzer`** (753 lines)
- Deep position-group analysis (guards/wings/bigs) cross-referenced against opponent defensive weaknesses
- Factors in player archetypes, pace, and positional matchup advantages
- Could surface role player overs you haven't considered

**2. `generate-matchup-scanner-picks`** (474 lines)
- Zone-based shot chart analysis (restricted area, paint, mid-range, corner 3, above-break 3)
- Grades each player's shooting zones vs opponent's zone defense
- Outputs scoring boost and threes boost recommendations with A+ through D grades

**3. `high-conviction-analyzer`** (244 lines)
- Cross-references mispriced lines against Risk, PropV2, Sharp, and Heat engine picks
- Finds players flagged by **multiple engines** simultaneously — the strongest consensus plays
- Could confirm or add to your 8 locked legs

**4. `double-confirmed-scanner`** (178 lines)
- Matches Sweet Spots (70%+ L10 hit rate) against Mispriced Lines (15%+ edge)
- Any player appearing in BOTH is a "double confirmed" lock
- Quick scan, lightweight

**5. `heat-prop-engine`** (1,472 lines)
- Sharp signal detection (juice divergence, line moves against public, early sharp snaps)
- Role-player-first methodology with poison flip map
- Could find sharp money flowing into your matchup games

**6. `detect-mispriced-lines`**
- Defense-adjusted line projections — adjusts L10 avg by opponent rank before calculating edge
- Already partially covered in your earlier analysis, but a fresh run could catch new lines

**7. `nba-mega-parlay-scanner`** (1,469 lines)
- Massive scanner that combines all signals into composite scores
- Prop overlap prevention built in
- Could validate your full 8-leg ticket or suggest swaps

### Recommended Pipeline

Run these in sequence, filtering results to only your 3 matchup games:

```text
Step 1: matchup-intelligence-analyzer  → positional matchup edges
Step 2: generate-matchup-scanner-picks → zone-based shot chart grades  
Step 3: high-conviction-analyzer       → multi-engine consensus
Step 4: double-confirmed-scanner       → sweet spot + mispriced overlap
Step 5: heat-prop-engine               → sharp money signals
```

Each engine call filters to ATL@MIL, POR@MEM, UTA@PHI and returns any new picks not already in your locked 8 legs.

### Implementation

No code changes needed — this is invoking existing edge functions via `supabase.functions.invoke()` and filtering results to your target teams. I'll run each engine, present the findings, and you decide if any new picks should be added or swapped into the ticket.

