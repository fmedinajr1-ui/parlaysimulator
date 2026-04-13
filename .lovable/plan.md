

# Correlated Team Total Gate for Hits & Total Bases

## Problem
Player hits and total bases lines should only recommend UNDER if the team game total also dropped (confirming lower-scoring game expectation), and only OVER if the team total also rose. Currently, direction is determined purely from the player's own line movement without checking team-level context.

## Change

**File**: `supabase/functions/fanduel-prediction-alerts/index.ts`

### 1. Build a team total drift map (before signal loops, ~line 683)

After building `eventMatchup`, iterate through `groups` to find totals entries for each event and calculate their drift direction:

```typescript
// Build event total drift map: did the game total go up or down?
const eventTotalDrift = new Map<string, number>();
for (const [, snapshots] of groups) {
  const first = snapshots[0];
  if (first.prop_type === 'totals' && snapshots.length >= 2) {
    const last = snapshots[snapshots.length - 1];
    const drift = last.line - first.line;
    eventTotalDrift.set(first.event_id, drift);
  }
}
```

### 2. Add correlation gate in velocity spike/cascade loop (~line 757, after `side` is determined)

For hits and total_bases props, check if the team total moved in the same direction. If they disagree, block the signal:

```typescript
// Correlated team total gate for hits/total_bases
const TEAM_CORRELATED_PROPS = new Set(['batter_hits', 'hits', 'batter_total_bases', 'total_bases']);
if (TEAM_CORRELATED_PROPS.has(first.prop_type)) {
  const totalDrift = eventTotalDrift.get(first.event_id);
  if (totalDrift !== undefined) {
    const totalDirection = totalDrift < 0 ? 'UNDER' : 'OVER';
    if (totalDirection !== side) {
      log(`🚫 BLOCKED ${first.player_name} ${first.prop_type} ${side}: team total moved ${totalDirection}`);
      continue;
    }
  }
}
```

### 3. Same gate in Take It Now (snapback) loop (~line 925, after `snapDirection` is set)

Apply the same check for snapback signals on hits/total_bases:

```typescript
// Correlated team total gate for hits/total_bases snapbacks
if (TEAM_CORRELATED_PROPS.has(last.prop_type)) {
  const totalDrift = eventTotalDrift.get(last.event_id);
  if (totalDrift !== undefined) {
    const totalDirection = totalDrift < 0 ? 'UNDER' : 'OVER';
    if (totalDirection !== snapDirection) {
      log(`🚫 BLOCKED TIN ${last.player_name} ${last.prop_type} ${snapDirection}: team total moved ${totalDirection}`);
      continue;
    }
  }
}
```

## Logic Summary
- Player hits/TB line drops + team total drops → UNDER ✅
- Player hits/TB line drops + team total rises → BLOCKED ❌
- Player hits/TB line rises + team total rises → OVER ✅  
- Player hits/TB line rises + team total drops → BLOCKED ❌
- No team total data available → signal passes through unchanged

## After Deploy
Re-invoke the function to regenerate signals with the correlation gate active.

