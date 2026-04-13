

# Fix: L10 Average Gate Not Applied to Cascade Alerts

## Problem

The screenshot shows players like **Mitch Garver (L10 0 avg)** and **Luke Raley (L10 0.3 avg)** in CASCADE alerts. These should be blocked.

**Root cause**: Line 401-404 in `hrb-mlb-rbi-analyzer/index.ts` — cascade alerts skip the entire L10 validation block:
```typescript
if (alert.signal_type === 'cascade') {
  // Already validated during cascade construction
  validatedAlerts.push(alert);
  continue;  // ← skips the L10 avg gate at line 418
}
```

The cascade construction (line 316-386) only checks the **team-level** confirmation ratio (≥40% of players must confirm). It does NOT apply the L10 average range gate to individual players within the cascade.

## Fix (1 change, ~10 lines)

**File**: `supabase/functions/hrb-mlb-rbi-analyzer/index.ts`

### Tighten range to 0.4–0.7 and apply it inside cascade construction

In the per-player loop (~line 335), after getting `stats`, filter out players whose L10 avg is outside 0.4–0.7 before counting them toward the cascade. Players outside the range get marked `'avg_blocked'` and excluded from the confirmation ratio.

Also update the standalone gate at line 419 from `0.25–0.7` → `0.4–0.7`.

This means:
- **Mitch Garver (0.0 avg)** → blocked from cascade count
- **Luke Raley (0.3 avg)** → blocked from cascade count  
- **Christian Walker (0.7 avg)** → passes (right at boundary)
- **Cole Young (0.5 avg)** → passes

If too many players get filtered out, the cascade won't meet the 40% confirmation threshold and the whole alert gets blocked.

