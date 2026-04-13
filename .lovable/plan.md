

# Tighten L10 RBI Gate for Unders

## Problem
The 0.0–0.2 L10 average bucket has a 30.9% win rate for RBI Unders, dragging down overall accuracy. Players with near-zero L10 averages likely have lines already at 0.5 (the floor), leaving no room for the Under to hit.

## Change

**File**: `supabase/functions/hrb-mlb-rbi-analyzer/index.ts` (~line 414)

Add an L10 average range check alongside the existing hit-rate gate for Under picks:

```typescript
// Existing hit-rate gate (line ~414)
if (alert.prediction === 'Under' && stats.l10HitRate > 0.8) {
  log(`L10 block: ${alert.player_name} Under — hit rate too high`);
  continue;
}

// NEW: L10 avg range gate for Unders
if (alert.prediction === 'Under' && (stats.l10Avg < 0.25 || stats.l10Avg > 0.7)) {
  log(`L10 avg block: ${alert.player_name} Under — L10 avg ${stats.l10Avg} outside [0.25, 0.7]`);
  continue;
}
```

This filters out:
- Players with L10 avg < 0.25 (line already at floor, no edge)
- Players with L10 avg > 0.7 (too productive, Under is risky)

Only the sweet spot (0.25–0.7) passes through, which historically hits at 89–99%.

