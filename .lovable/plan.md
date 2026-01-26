

## Enhanced Lock Mode Debug Logging

### Overview
Add comprehensive debug logging to all Lock Mode gates and provide a consolidated summary per edge, making it easy to diagnose exactly why edges fail each gate.

---

### Current Logging Status

| Gate/Function | Has Logging | Status |
|---------------|-------------|--------|
| Gate 1 (Minutes & Rotation) | Yes | Lines 62-70 |
| Gate 2 (Stat Type) | **No** | Missing |
| Gate 3 (Edge vs Uncertainty) | **No** | Missing |
| Gate 4 (Under Rules) | Yes | Lines 142-149 |
| Confidence Filter | Yes | Lines 171-175 |
| Slot Matching | Yes | Lines 194-200 |
| Per-Edge Summary | **No** | Missing |
| Final Slip Summary | **No** | Missing |

---

### Implementation Changes

#### 1. Add Gate 2 (Stat Type) Logging

```typescript
function passesStatTypeGate(prop: PropType): LockModeGate {
  const tier = getStatTier(prop);
  
  // NEW: Debug logging
  console.log(`[Lock Mode] Gate 2 Stat Type: ${prop} → ${tier || 'BLOCKED'}`);
  
  return {
    passed: tier !== null,
    reason: tier === null ? `${prop} not allowed in Lock Mode` : undefined,
  };
}
```

#### 2. Add Gate 3 (Edge vs Uncertainty) Logging

```typescript
function passesEdgeUncertaintyGate(edge: PropEdge): LockModeGate {
  const projectedEdge = Math.abs((edge.expectedFinal || 0) - edge.line);
  const uncertainty = edge.uncertainty || 1;
  const threshold = uncertainty * LOCK_MODE_THRESHOLDS.EDGE_UNCERTAINTY_MULTIPLIER;
  const passed = projectedEdge >= threshold && projectedEdge > LOCK_MODE_THRESHOLDS.MIN_ABSOLUTE_EDGE;

  // NEW: Debug logging
  console.log(`[Lock Mode] Gate 3 Edge ${edge.player} ${edge.prop}:`, {
    expectedFinal: edge.expectedFinal,
    line: edge.line,
    projectedEdge: projectedEdge.toFixed(2),
    uncertainty: uncertainty.toFixed(2),
    threshold: threshold.toFixed(2),
    minAbsoluteEdge: LOCK_MODE_THRESHOLDS.MIN_ABSOLUTE_EDGE,
    passed,
  });

  return {
    passed,
    reason: !passed
      ? `Edge ${projectedEdge.toFixed(1)} < ${threshold.toFixed(1)} (unc × ${LOCK_MODE_THRESHOLDS.EDGE_UNCERTAINTY_MULTIPLIER})`
      : undefined,
  };
}
```

#### 3. Add Per-Edge Consolidated Summary

In `buildLockModeSlip`, add a summary log after running all gates:

```typescript
// After running all gates
const allGatesPass = minutesGate.passed && statTypeGate.passed && 
                     edgeUncertaintyGate.passed && underGate.passed && 
                     passesConfidenceGate(edge);

// NEW: Consolidated per-edge summary
console.log(`[Lock Mode] === ${edge.player} ${edge.prop} ${edge.lean} ===`, {
  gates: {
    minutes: minutesGate.passed ? '✓' : `✗ ${minutesGate.reason}`,
    statType: statTypeGate.passed ? '✓' : `✗ ${statTypeGate.reason}`,
    edgeUncertainty: edgeUncertaintyGate.passed ? '✓' : `✗ ${edgeUncertaintyGate.reason}`,
    underRules: edge.lean === 'UNDER' ? (underGate.passed ? '✓' : `✗ ${underGate.reason}`) : 'N/A',
    confidence: passesConfidenceGate(edge) ? '✓' : '✗ Low confidence',
  },
  allGatesPass,
  slot: allGatesPass ? getSlotType(edge, playerState) || 'NO_SLOT' : 'BLOCKED',
});
```

#### 4. Add Slot Matching Failure Logging

When slot matching returns null, log why:

```typescript
const slot = getSlotType(edge, playerState);
if (!slot) {
  // NEW: Log why slot matching failed
  console.log(`[Lock Mode] Slot FAILED ${edge.player} ${edge.prop} ${edge.lean}:`, {
    role: playerState?.role,
    currentStat: edge.currentStat,
    minutesPlayed: edge.minutesPlayed,
    edgeMargin: edge.edgeMargin,
    fatigue: playerState?.fatigueScore,
    reason: 'No matching slot criteria met',
  });
  continue;
}
```

#### 5. Add Final Slip Summary

At the end of `buildLockModeSlip`, log the final result:

```typescript
// After filling slots
console.log(`[Lock Mode] ========== SLIP SUMMARY ==========`);
console.log(`[Lock Mode] Total edges evaluated: ${edges.length}`);
console.log(`[Lock Mode] Candidates that passed all gates: ${candidates.length}`);
console.log(`[Lock Mode] Slots filled:`, {
  BIG_REB_OVER: slots.BIG_REB_OVER?.player || 'EMPTY',
  ASSIST_OVER: slots.ASSIST_OVER?.player || 'EMPTY',
  FLEX: slots.FLEX?.player || 'EMPTY',
});
console.log(`[Lock Mode] Valid slip: ${filledLegs.length === 3 ? 'YES' : 'NO'}`);
if (missingSlots.length > 0) {
  console.log(`[Lock Mode] Missing slots: ${missingSlots.join(', ')}`);
}
console.log(`[Lock Mode] ====================================`);
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/lockModeEngine.ts` | Add logging to Gate 2, Gate 3, per-edge summary, slot failure, and final summary |

---

### Expected Console Output

After these changes, the console will show:

```
[Lock Mode] Gate 1 Pascal Siakam Points: {role: "STARTER", isStarterOrCloser: true, ...}
[Lock Mode] Gate 2 Stat Type: Points → TIER_3
[Lock Mode] Gate 3 Edge Pascal Siakam Points: {expectedFinal: 22.5, line: 18.5, projectedEdge: "4.00", ...}
[Lock Mode] Confidence check Pascal Siakam Points: {confidence: 72, minRequired: 55, passed: true}
[Lock Mode] === Pascal Siakam Points OVER === {
  gates: {minutes: "✓", statType: "✓", edgeUncertainty: "✓", underRules: "N/A", confidence: "✓"},
  allGatesPass: true,
  slot: "FLEX"
}
...
[Lock Mode] ========== SLIP SUMMARY ==========
[Lock Mode] Total edges evaluated: 42
[Lock Mode] Candidates that passed all gates: 8
[Lock Mode] Slots filled: {BIG_REB_OVER: "Onyeka Okongwu", ASSIST_OVER: "Dyson Daniels", FLEX: "Pascal Siakam"}
[Lock Mode] Valid slip: YES
[Lock Mode] ====================================
```

---

### Benefits

1. **Complete Visibility**: Every gate decision is logged with reasoning
2. **Easy Diagnosis**: Consolidated summary shows all gates at once per edge
3. **Slot Tracking**: Clear indication of which slots are filled/empty
4. **Threshold Awareness**: Logs include the threshold values being compared against
5. **Quick Filtering**: Use browser console filter `[Lock Mode]` to see only relevant logs

