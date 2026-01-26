

## Lock Mode 3-Leg Implementation for Scout Page

### Overview
Add a new **Lock Mode** feature to the Scout's Halftime Betting Console that outputs exactly 3 legs with the highest structural certainty, applying brutal gatekeeping rules to eliminate variance.

---

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Scout Autonomous Agent                       │
├─────────────────────────────────────────────────────────────────┤
│  Halftime Betting Console (Tabs)                                │
│  ┌──────────┬──────────────┬──────────┬────────────────┐       │
│  │Game Bets │ Player Props │ Advanced │ LOCK MODE (NEW)│       │
│  └──────────┴──────────────┴──────────┴────────────────┘       │
│                                                                 │
│  Lock Mode Tab Content:                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Header: LOCK MODE - 3 LEG SLIP                          │   │
│  │ Subtitle: Only highest-certainty halftime plays         │   │
│  │                                                          │   │
│  │ ┌────────────────────────────────────────────────────┐  │   │
│  │ │ Leg 1: BIG/WING REBOUND OVER                       │  │   │
│  │ │ Gobert REB O11.5                                   │  │   │
│  │ │ Proj 13.2 ± 1.1  Edge +1.7                         │  │   │
│  │ │ Minutes: 9.8 ± 0.9                                 │  │   │
│  │ │ Reason: Strong box-outs · Stable closer minutes    │  │   │
│  │ └────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │ ┌────────────────────────────────────────────────────┐  │   │
│  │ │ Leg 2: ASSIST OVER                                 │  │   │
│  │ │ Haliburton AST O9.5                                │  │   │
│  │ │ Proj 11.4 ± 0.8  Edge +1.9                         │  │   │
│  │ │ Minutes: 11.2 ± 0.5                                │  │   │
│  │ │ Reason: Primary playmaker · Elite usage            │  │   │
│  │ └────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │ ┌────────────────────────────────────────────────────┐  │   │
│  │ │ Leg 3: STAR_FLOOR POINTS OR FATIGUE UNDER          │  │   │
│  │ │ Edwards PTS O29.5                                  │  │   │
│  │ │ Proj 34.2 ± 2.1  Edge +4.7                         │  │   │
│  │ │ Minutes: 10.1 ± 0.6                                │  │   │
│  │ │ Reason: STAR_FLOOR + low uncertainty               │  │   │
│  │ └────────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │ [Copy All 3 Legs] button                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Empty State (if no 3 valid legs):                              │
│  "No Lock Mode slip available. Pass on this slate."            │
└─────────────────────────────────────────────────────────────────┘
```

---

### File Changes

#### 1. New Type Definitions (`src/types/scout-agent.ts`)

Add Lock Mode specific types:

```typescript
// Lock Mode Types
export type LockModeStatTier = 'TIER_1' | 'TIER_2' | 'TIER_3';
export type LockModeLegSlot = 'BIG_REB_OVER' | 'ASSIST_OVER' | 'FLEX';

export interface LockModeGate {
  passed: boolean;
  reason?: string;
}

export interface LockModeLeg {
  player: string;
  prop: PropType;
  line: number;
  lean: 'OVER' | 'UNDER';
  projected: number;
  uncertainty: number;
  edge: number;
  minutesRemaining: number;
  minutesUncertainty: number;
  calibratedConfidence: number;
  drivers: string[]; // Max 2 reasons
  slot: LockModeLegSlot;
  gates: {
    minutes: LockModeGate;
    statType: LockModeGate;
    edgeVsUncertainty: LockModeGate;
    underRules?: LockModeGate;
  };
}

export interface LockModeSlip {
  legs: LockModeLeg[]; // Exactly 0 or 3
  generatedAt: string;
  gameTime: string;
  isValid: boolean;
  blockReason?: string;
}
```

#### 2. Lock Mode Engine (`src/lib/lockModeEngine.ts`)

Create the core logic with 4 non-negotiable gates:

```typescript
// GATE 1: Minutes & Rotation Check
function passesMinutesGate(edge: PropEdge, playerState: PlayerLiveState): LockModeGate {
  const role = edge.rotationRole?.toUpperCase();
  const isStarterOrCloser = role === 'STARTER' || role === 'CLOSER';
  const hasStableMinutes = !edge.rotationVolatilityFlag;
  const noFoulTrouble = (playerState?.foulCount || 0) <= 3;
  const minFirstHalfMinutes = (playerState?.minutesEstimate || 0) >= 14;
  
  const passed = isStarterOrCloser && hasStableMinutes && noFoulTrouble && minFirstHalfMinutes;
  
  return {
    passed,
    reason: !passed ? 
      !isStarterOrCloser ? 'Not STARTER/CLOSER' :
      !hasStableMinutes ? 'Minutes volatile' :
      !noFoulTrouble ? 'Foul trouble (>3)' :
      '1H minutes < 14' : undefined
  };
}

// GATE 2: Stat Type Priority (Tier 1 > Tier 2 > Tier 3)
function getStatTier(prop: PropType): LockModeStatTier | null {
  if (prop === 'Rebounds' || prop === 'Assists') return 'TIER_1';
  if (prop === 'PRA') return 'TIER_2';
  if (prop === 'Points') return 'TIER_3';
  return null; // Blocks Threes, Steals, Blocks
}

// GATE 3: Edge vs Uncertainty
function passesEdgeUncertaintyGate(edge: PropEdge): LockModeGate {
  const projectedEdge = Math.abs((edge.expectedFinal || 0) - edge.line);
  const uncertainty = edge.uncertainty || 0;
  
  // Edge must be >= 1.25x uncertainty
  const threshold = uncertainty * 1.25;
  const passed = projectedEdge >= threshold && projectedEdge > 0.5;
  
  return {
    passed,
    reason: !passed ? 
      `Edge ${projectedEdge.toFixed(1)} < ${threshold.toFixed(1)} (unc × 1.25)` : undefined
  };
}

// GATE 4: Stricter UNDER Rules
function passesUnderGate(
  edge: PropEdge, 
  playerState: PlayerLiveState,
  opponentDefenseVerified: boolean
): LockModeGate {
  if (edge.lean === 'OVER') return { passed: true };
  
  const fatigue = playerState?.fatigueScore || 0;
  const fatigueOk = fatigue >= 65;
  
  const l10Avg = edge.line; // Approximate
  const stdDev = edge.uncertainty || 0;
  const varianceLow = (stdDev / Math.max(l10Avg, 1)) <= 0.30;
  
  const noBreakout = !edge.riskFlags?.includes('BREAKOUT_RISK');
  const noGarbageTime = !edge.riskFlags?.includes('BLOWOUT_RISK');
  
  const passed = fatigueOk && varianceLow && noBreakout && opponentDefenseVerified && noGarbageTime;
  
  return {
    passed,
    reason: !passed ?
      !fatigueOk ? `Fatigue ${fatigue} < 65` :
      !varianceLow ? 'Variance too high' :
      !noBreakout ? 'Breakout signal detected' :
      !opponentDefenseVerified ? 'Defense not verified' :
      'Garbage time risk' : undefined
  };
}

// Main Lock Mode Builder
function buildLockModeSlip(
  edges: PropEdge[],
  playerStates: Map<string, PlayerLiveState>,
  gameTime: string
): LockModeSlip {
  // ... filter through all 4 gates
  // ... select exactly 3 legs (BIG_REB_OVER, ASSIST_OVER, FLEX)
  // ... return empty slip if can't fill all 3 slots
}
```

#### 3. Lock Mode Tab Component (`src/components/scout/LockModeTab.tsx`)

New UI component for the Lock Mode tab:

```typescript
interface LockModeTabProps {
  edges: PropEdge[];
  playerStates: Map<string, PlayerLiveState>;
  gameTime: string;
  isHalftime: boolean;
}

export function LockModeTab({ edges, playerStates, gameTime, isHalftime }: LockModeTabProps) {
  const slip = useMemo(() => 
    buildLockModeSlip(edges, playerStates, gameTime),
    [edges, playerStates, gameTime]
  );
  
  // Render header, 3 legs (or empty state), copy button
}
```

#### 4. Lock Mode Leg Card (`src/components/scout/LockModeLegCard.tsx`)

Minimal, noise-free leg display:

```
┌─────────────────────────────────────────────┐
│ Gobert REB O11.5                            │
│ Proj 13.2 ± 1.1   Edge +1.7                 │
│ Minutes: 9.8 ± 0.9                          │
│ Reason: Strong box-outs · Stable closer min │
└─────────────────────────────────────────────┘
```

Only shows: Player + Prop + Line, Projected ± Uncertainty, Edge, Minutes ± Uncertainty, Max 2 reasons.

#### 5. Update Scout Autonomous Agent (`src/components/scout/ScoutAutonomousAgent.tsx`)

Add new Lock Mode tab to the Halftime Betting Console tabs:

```typescript
<Tabs defaultValue="bets">
  <TabsList>
    <TabsTrigger value="bets">Game Bets</TabsTrigger>
    <TabsTrigger value="props">Player Props</TabsTrigger>
    <TabsTrigger value="lock" className="gap-1.5">
      <Lock className="w-3.5 h-3.5" />
      Lock Mode
    </TabsTrigger>
    <TabsTrigger value="advanced">Advanced</TabsTrigger>
  </TabsList>
  
  {/* ... existing tabs ... */}
  
  <TabsContent value="lock">
    <LockModeTab
      edges={state.activePropEdges}
      playerStates={state.playerStates}
      gameTime={state.currentGameTime || ''}
      isHalftime={state.halftimeLock.isLocked}
    />
  </TabsContent>
</Tabs>
```

---

### Lock Mode Selection Logic

#### Leg Priority Order

| Slot | Target | Criteria |
|------|--------|----------|
| Leg 1 | BIG/WING Rebound OVER | Role = BIG or glass wing, stable minutes, prefer slow pace games |
| Leg 2 | Assist OVER | PRIMARY/SECONDARY role, usage stable, not scoring-dependent |
| Leg 3 | FLEX | STAR_FLOOR_OVER (points) OR PRA for BIG with elite minutes OR Fatigue-verified UNDER |

#### Confidence Threshold

Only legs with **calibrated confidence >= 72%** are eligible. Legs with `HIGH_VARIANCE` or `EARLY_PROJECTION` flags are blocked.

---

### Empty State Behavior

If any of the 3 slots cannot be filled, the entire slip is blocked:

```
┌─────────────────────────────────────────────┐
│           NO LOCK MODE SLIP TODAY           │
│                                             │
│  Could not fill all 3 required slots.       │
│  This is a pass, not a failure.             │
│                                             │
│  Missing: [Leg 2: Assist OVER]              │
│  Reason: No stable playmaker edges found    │
└─────────────────────────────────────────────┘
```

---

### Summary of Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/types/scout-agent.ts` | Modify | Add Lock Mode types |
| `src/lib/lockModeEngine.ts` | Create | Gate logic + slip builder |
| `src/components/scout/LockModeTab.tsx` | Create | Tab container component |
| `src/components/scout/LockModeLegCard.tsx` | Create | Minimal leg display card |
| `src/components/scout/ScoutAutonomousAgent.tsx` | Modify | Add Lock Mode tab |

---

### Why This Works

- **3 legs = 42% win rate** (vs 17% for 6 legs at 75% each)
- **Gate 1 (Minutes)** eliminates rotation chaos
- **Gate 2 (Stat Type)** focuses on lowest-variance props
- **Gate 3 (Edge vs Uncertainty)** stops "lose by 1" hell
- **Gate 4 (UNDER Rules)** prevents the historical UNDER bleed
- **Zero output is valid** - prevents forced bets

