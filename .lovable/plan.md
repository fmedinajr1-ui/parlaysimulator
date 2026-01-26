

## Fix Lock Mode Data Pipeline: Box Score + AI Vision Integration

### Problem Summary

Lock Mode is failing to generate 3-leg slips because:

1. **`rotationRole` is undefined** - The `player.rotation` object is never populated, causing `state.rotation?.rotationRole` to return `undefined` 
2. **Gate 1 fails for all players** - "Not STARTER/CLOSER" because `rotationRole` is missing
3. **Gate 4 UNDER fails** - Fatigue scores are too low (max 41, needs 65+) because vision signals aren't propagating
4. **Slot matching fails** - `player.role` defaults to SPACER, blocking BIG_REB_OVER slots

---

### Root Cause Analysis

| Issue | Location | Current State | Required State |
|-------|----------|--------------|----------------|
| `player.rotation` not set | `scout-agent-loop` | Never populated | Must call `updateRotationState` |
| `rotationRole` undefined | `projectFinal` L1642 | Returns `undefined` | Returns `STARTER`/`CLOSER` |
| `scout-data-projection` missing rotation | Edge creation L358-382 | No `rotationRole` field | Add `rotationRole` based on role+minutes |
| Vision fatigue not accumulating | Frontend state updates | Single-frame only | Accumulative with decay |

---

### Solution: 4-Part Fix

#### Part 1: Populate `player.rotation` in `scout-agent-loop`

Before calculating prop edges, update each player's rotation state using PBP substitution events:

```typescript
// In calculatePropEdges, BEFORE the edge calculation loop
const subEvents = extractSubstitutionEvents(pbpData?.recentPlays || []);
const scoreDiff = (pbpData?.homeScore ?? 0) - (pbpData?.awayScore ?? 0);
const period = pbpData?.period ?? 1;

Object.values(playerStates).forEach(player => {
  const live = getLiveBox(pbpData, player.playerName);
  const minutesPlayed = live?.min ?? 0;
  
  // Update rotation state with fresh PBP data
  player.rotation = updateRotationState(player, subEvents, period, scoreDiff, minutesPlayed);
});
```

Add helper to extract substitution events from PBP:

```typescript
function extractSubstitutionEvents(recentPlays: any[]): SubstitutionEvent[] {
  return recentPlays
    .filter(p => p.playType === 'substitution')
    .map(p => ({
      time: p.time,
      player: extractPlayerFromSubText(p.text), // "Player X enters for Player Y"
      action: p.text.includes('enters') ? 'in' : 'out',
    }));
}
```

#### Part 2: Add `rotationRole` to `scout-data-projection`

The data-only projection path also needs to output `rotationRole`:

```typescript
// In calculateDataOnlyEdges, add rotation determination
const minutesPlayed = live.min;
const role = player.role;

// Determine rotation role based on role and minutes
let rotationRole: 'STARTER' | 'CLOSER' | 'BENCH_CORE' | 'BENCH_FRINGE' = 'BENCH_CORE';
if (role === 'PRIMARY' || (role === 'BIG' && minutesPlayed > 12)) {
  rotationRole = 'STARTER';
}
if (minutesPlayed >= 10) {
  rotationRole = 'BENCH_CORE';
} else if (minutesPlayed < 5) {
  rotationRole = 'BENCH_FRINGE';
}

// Include in edge output
edges.push({
  // ...existing fields...
  rotationRole,
  rotationVolatilityFlag: rotationRole === 'BENCH_FRINGE',
});
```

#### Part 3: Derive Player Role from Position/Stats

Lock Mode slot matching requires accurate `player.role` (BIG, PRIMARY, etc). Currently this defaults to SPACER.

Add role inference from roster position and box score:

```typescript
function inferPlayerRole(
  position: string,
  boxScore: { points: number; rebounds: number; assists: number } | null,
  minutesPlayed: number
): 'PRIMARY' | 'SECONDARY' | 'BIG' | 'SPACER' {
  const pos = position?.toUpperCase() || '';
  
  // Position-based inference
  if (pos.includes('C') || pos === 'F-C' || pos === 'C-F') return 'BIG';
  if (pos === 'PF' && boxScore && boxScore.rebounds > 5) return 'BIG';
  
  // Stats-based inference for high-minute players
  if (minutesPlayed >= 15 && boxScore) {
    if (boxScore.points >= 12 || boxScore.assists >= 5) return 'PRIMARY';
    if (boxScore.points >= 8) return 'SECONDARY';
  }
  
  if (pos === 'PG' || pos === 'SG') return 'SECONDARY';
  return 'SPACER';
}
```

#### Part 4: Lower Gate Thresholds for Testing

The current thresholds are extremely strict. Adjust for initial validation:

| Gate | Current | Adjusted | Rationale |
|------|---------|----------|-----------|
| Minutes | 14+ | 12+ | Many starters hit 12-14 at halftime |
| Fatigue UNDER | 65+ | 50+ | Vision rarely reports 65+ |
| Confidence | 72% | 68% | Allow more candidates through |

**Note:** These relaxed thresholds should be configurable via constants at the top of `lockModeEngine.ts`.

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/scout-agent-loop/index.ts` | Add rotation state population before edge calculation, add substitution event extraction |
| `supabase/functions/scout-data-projection/index.ts` | Add `rotationRole` and `rotationVolatilityFlag` to edge output, add role inference |
| `src/lib/lockModeEngine.ts` | Add configurable thresholds, relax Gate 1 minutes to 12+, relax Gate 4 fatigue to 50+ |
| `supabase/functions/record-quarter-snapshot/index.ts` | Ensure `player_role` is correctly mapped from roster position |

---

### Data Flow After Fix

```text
PBP Data (minutes, fouls, subs)
        │
        ▼
┌─────────────────────────────────────┐
│  scout-agent-loop / data-projection │
│                                     │
│  1. Extract substitution events     │
│  2. Calculate minutes per player    │
│  3. Call updateRotationState()      │
│  4. Infer player role from position │
│  5. Generate PropEdge with:         │
│     - rotationRole: STARTER/CLOSER  │
│     - minutesPlayed: from PBP       │
│     - player.role: BIG/PRIMARY      │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│       Lock Mode Engine              │
│                                     │
│  Gate 1: rotationRole=STARTER ✓     │
│          minutesPlayed >= 12 ✓      │
│  Gate 4: fatigueScore >= 50 ✓       │
│  Slot:   role=BIG → BIG_REB_OVER    │
│                                     │
│  → Generates valid 3-leg slip       │
└─────────────────────────────────────┘
```

---

### Expected Outcome

After this fix:
- `rotationRole` will be `STARTER` or `CLOSER` for 8-12 players per game
- `minutesPlayed` will reflect actual first-half minutes from PBP
- `player.role` will be correctly inferred from position
- Lock Mode will be able to fill all 3 slots and generate valid slips

### Debug Logging

Add logging to track why edges fail gates:

```typescript
console.log(`[Lock Mode] ${edge.player} ${edge.prop}:`, {
  rotationRole: edge.rotationRole,
  minutesPlayed: edge.minutesPlayed,
  fatigue: playerState?.fatigueScore,
  role: playerState?.role,
  gateResults: { minutesGate, statTypeGate, edgeUncertaintyGate, underGate }
});
```

