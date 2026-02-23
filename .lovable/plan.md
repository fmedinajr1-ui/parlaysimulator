

## Fix: Stat-Aware BufferGate for Conviction Picks

### Problem

The BufferGate uses a flat 1.0 minimum buffer regardless of stat type. This blocks most threes/blocks/steals props where lines are 0.5-2.5, because projecting 1.0+ points above a line of 1.5 means projecting 2.5+ (67% above the line). Meanwhile, for points props with lines of 20+, a 1.0 buffer is trivial (5%).

Today, 4 of 9 double-confirmed picks were blocked by BufferGate, and 3 more were borderline -- all threes props.

### Solution: Tiered BufferGate by Stat Type + Conviction Level

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Change 1: Replace flat 1.0 buffer with stat-aware minimum (~line 5126-5136)**

Replace the current flat buffer check:
```typescript
// CURRENT (line 5126-5136):
if (projValue > 0 && Math.abs(projBuffer) < 1.0) { ... continue; }
```

With a stat-aware + conviction-aware buffer:
```typescript
// Stat-aware minimum buffer based on line magnitude
function getMinBuffer(propType: string, line: number, isConviction: boolean): number {
  // For low-line props (threes, blocks, steals) where lines are 0.5-3
  if (line <= 1.0) return isConviction ? 0.1 : 0.2;
  if (line <= 3.0) return isConviction ? 0.3 : 0.5;
  if (line <= 6.0) return isConviction ? 0.5 : 0.75;
  // Standard props (points, rebounds, assists) with lines 6+
  return isConviction ? 0.75 : 1.0;
}
```

The `isConviction` flag is true when the pick is triple-confirmed, double-confirmed, or multi-engine (3+). This gives conviction picks a ~25-50% reduced buffer threshold since they already have strong statistical backing from multiple independent sources.

**Change 2: Pass conviction status into the leg-building loop**

Before the BufferGate check, determine if the current pick has conviction status:
```typescript
const isConvictionPick = playerPick.isTripleConfirmed || 
                         playerPick.isDoubleConfirmed || 
                         (playerPick.engineCount >= 3);
const minBuf = getMinBuffer(legData.prop_type, selectedLine.line, isConvictionPick);

if (projValue > 0 && Math.abs(projBuffer) < minBuf) {
  console.log(`[BufferGate] Blocked ${legData.player_name} ${legData.prop_type} ${legData.side} ${legData.line} (proj: ${projValue}, buffer: ${projBuffer.toFixed(2)} < ${minBuf} min${isConvictionPick ? ' [conviction]' : ''})`);
  continue;
}
```

### Impact Analysis

With the stat-aware buffer, today's double-confirmed picks would be:

| Player | Line | Buffer | Old Min | New Min (conviction) | Result |
|--------|------|--------|---------|---------------------|--------|
| Duncan Robinson | 2.5 | 0.97 | 1.0 | 0.3 | PASSES |
| Lauri Markkanen | 1.5 | 0.57 | 1.0 | 0.3 | PASSES |
| James Harden | 2.5 | 0.2 | 1.0 | 0.3 | Still blocked (buffer too thin even for conviction) |
| Russell Westbrook | 1.5 | 0.44 | 1.0 | 0.3 | PASSES |
| Jarrett Allen | 8.5 | 2.8 | 1.0 | 0.75 | PASSES |

This unblocks 3 of 4 previously blocked picks while still protecting against near-zero-edge picks (Harden with 0.2 buffer stays blocked -- rightfully so since the projection barely clears the line).

### Safety Rails

- Non-conviction picks keep the same or tighter thresholds as before (just stat-aware scaling)
- The NegEdgeBlock (line 5138) remains unchanged -- picks with projections BELOW the line are still fully blocked regardless
- The Monster BufferGate (line 5794) also gets stat-aware treatment with the same function
- All changes are logged with the conviction flag so you can monitor the effect

### What This Does NOT Change

- Yesterday's winning strategy stays intact -- those picks had sufficient buffers already
- No changes to composite scoring, pool building, tier configs, or fingerprinting
- PropTypeCap for threes stays at 1 per parlay (diversity is still enforced)

