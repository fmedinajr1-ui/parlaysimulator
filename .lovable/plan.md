
# Plan: Fix Lock Mode Rotation Role Assignment

## Problem Summary

Lock Mode currently fails to generate "guaranteed locks" pre-game because:
- The `determineRotationRole` function relies on **live game minutes** to classify players
- Pre-game, `minutesPlayed = 0`, causing most players to be classified as `BENCH_FRINGE`
- Lock Mode Gate 1 rejects `BENCH_FRINGE` players, blocking valid candidates

## Root Cause Analysis

```text
Pre-Game Flow (Current - Broken):
┌─────────────────────────────────────────────────────────────┐
│ player_season_stats.avg_minutes = 34.3 (e.g., Damian Lillard)│
│                          ↓                                   │
│ calculatePreGameBaseline → minutesEstimate = 34.3           │
│                          ↓                                   │
│ initializePlayerStates → role = 'SECONDARY' (from position) │
│                          ↓                                   │
│ NO rotation.rotationRole initialized!                        │
│                          ↓                                   │
│ scout-agent-loop → determineRotationRole(minutesPlayed=0)   │
│                          ↓                                   │
│ Result: BENCH_FRINGE (because minutesPlayed < 5)            │
│                          ↓                                   │
│ Lock Mode Gate 1: REJECTED                                   │
└─────────────────────────────────────────────────────────────┘
```

## Solution Design

```text
Pre-Game Flow (Fixed):
┌─────────────────────────────────────────────────────────────┐
│ player_season_stats.avg_minutes = 34.3                       │
│                          ↓                                   │
│ calculatePreGameBaseline → minutesEstimate = 34.3           │
│                          ↓                                   │
│ NEW: derivePreGameRotationRole(avgMinutes=34.3)             │
│      → STARTER (because avg_minutes >= 28)                  │
│                          ↓                                   │
│ initializePlayerStates → rotation.rotationRole = STARTER    │
│                          ↓                                   │
│ scout-agent-loop → uses rotation.rotationRole from state    │
│                    (only overrides if live data available)  │
│                          ↓                                   │
│ Lock Mode Gate 1: PASSED                                     │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Add Pre-Game Rotation Role Derivation

**File: `src/types/pre-game-baselines.ts`**

Add a new function to derive rotation role from season average minutes:

```typescript
export function derivePreGameRotationRole(avgMinutes: number): RotationRole {
  if (avgMinutes >= 28) return 'STARTER';
  if (avgMinutes >= 20) return 'BENCH_CORE';
  if (avgMinutes >= 12) return 'BENCH_CORE';
  return 'BENCH_FRINGE';
}
```

Also extend `PreGameBaseline` interface to include `rotationRole`.

### Phase 2: Initialize Rotation State from Baselines

**File: `src/hooks/useScoutAgentState.ts`**

Modify `initializePlayerStates` to:
1. Extract `rotationRole` from pre-game baseline
2. Create initial `rotation` object with this role

```typescript
// Inside initPlayer function
const preGameRotationRole = derivePreGameRotationRole(baseline?.minutesEstimate ?? 0);

newStates.set(player.name, {
  // ... existing fields ...
  rotation: {
    stintSeconds: 0,
    benchSecondsLast8: 0,
    onCourtStability: preGameRotationRole === 'STARTER' ? 0.90 : 0.65,
    projectedStintsRemaining: 3,
    foulRiskLevel: 'LOW',
    rotationRole: preGameRotationRole,
  },
});
```

### Phase 3: Fix Multi-Game Manager Initialization

**File: `src/hooks/useMultiGameManager.ts`**

Apply the same fix to `initializePlayerStates` helper function.

### Phase 4: Preserve Pre-Game Role in Edge Function

**File: `supabase/functions/scout-agent-loop/index.ts`**

Modify `determineRotationRole` to respect pre-game assignment when no live data:

```typescript
function determineRotationRole(
  state: PlayerLiveState,
  period: number,
  scoreDiff: number,
  minutesPlayed: number
): RotationRole {
  // If we have live minutes data, use game context
  if (minutesPlayed >= 5) {
    // ... existing logic for live game ...
  }
  
  // Pre-game or early game: preserve pre-game assignment
  if (state.rotation?.rotationRole) {
    return state.rotation.rotationRole;
  }
  
  // Fallback: infer from expected minutes (pre-game baseline)
  const expectedMinutes = state.minutesEstimate || 0;
  if (expectedMinutes >= 28) return 'STARTER';
  if (expectedMinutes >= 20) return 'BENCH_CORE';
  if (expectedMinutes >= 12) return 'BENCH_CORE';
  
  return 'BENCH_FRINGE';
}
```

## Files to Modify

| File | Change |
|------|--------|
| `src/types/pre-game-baselines.ts` | Add `derivePreGameRotationRole` function, extend `PreGameBaseline` |
| `src/hooks/useScoutAgentState.ts` | Initialize `rotation.rotationRole` in `initializePlayerStates` |
| `src/hooks/useMultiGameManager.ts` | Apply same initialization fix |
| `supabase/functions/scout-agent-loop/index.ts` | Preserve pre-game role, only override with live data |

## Expected Results

### Before (Current State)
- Pre-game: Jayson Tatum (35.2 avg_min) → `BENCH_FRINGE` → Lock Mode rejects
- Lock Mode: "Missing 3 slots" / No slip generated

### After (Fixed)
- Pre-game: Jayson Tatum (35.2 avg_min) → `STARTER` → Lock Mode accepts
- Lock Mode: Valid 3-leg slip with high-minute starters

## Rotation Role Thresholds

Based on `player_season_stats` data analysis:

| Avg Minutes | Role | Example Players |
|-------------|------|-----------------|
| 28+ | `STARTER` | Jayson Tatum (35.2), Kyrie Irving (35.0), Damian Lillard (34.3) |
| 20-28 | `BENCH_CORE` | Gary Trent Jr (27.4), Cole Anthony (26.8) |
| 12-20 | `BENCH_CORE` | Role players with regular rotation spots |
| < 12 | `BENCH_FRINGE` | End-of-bench, garbage time players |

## Technical Notes

1. The fix preserves backward compatibility - live game data still overrides pre-game when available
2. Lock Mode Gate 1 already accepts `STARTER`, `CLOSER`, and `BENCH_CORE` roles
3. The `minutesEstimate` field was already being populated from pre-game baselines, just not being used for role classification
4. No database changes required - uses existing `player_season_stats.avg_minutes`
