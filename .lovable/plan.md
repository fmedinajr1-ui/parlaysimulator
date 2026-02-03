
# Fix Inaccurate Production Rate and UNDER Pick Display Logic

## Problems Identified (from Screenshot Analysis)

The screenshot shows a **3PT UNDER 1.5** pick with these issues:

### Issue 1: Production Rate Calculation (Mathematical Error)
**Current (Incorrect):**
```typescript
// Line 155-158 in useDeepSweetSpots.ts
const statPerMinute = validLogs.reduce((sum, log) => {
  const stat = log[field as keyof GameLog] as number;
  return sum + (stat / (log.minutes_played || 1)); // Average of per-game rates
}, 0) / validLogs.length;
```

This averages per-game rates, which is statistically incorrect. If a player has:
- Game 1: 1 three in 30 min = 0.033/min
- Game 2: 0 threes in 10 min = 0.000/min
- Current avg: (0.033 + 0) / 2 = 0.0165/min
- **Correct**: 1 three / 40 total min = **0.025/min**

**Fix:** Use total stats / total minutes for accurate production rate.

---

### Issue 2: Floor Protection Display for UNDER (Confusing)
- Screenshot shows: **L10 Min: 0 | Line: 1.5 | 75% Coverage**
- Current calculation: `l10Stats.max <= line ? 1.0 : line / l10Stats.max`
- If L10 Max is 2 and Line is 1.5: `1.5 / 2 = 75%`

This is **confusing** for users because:
- For UNDER: Floor protection should show how protected you are from the player EXCEEDING the line
- A better metric for UNDER would be: "X games under line" or "ceiling risk"

**Fix:** Add context label that changes based on side (Over = "Floor", Under = "Ceiling Risk").

---

### Issue 3: Minutes Verdict Inverted for UNDER (Misleading)
- Screenshot shows: **65min needed** with **UNLIKELY** in red
- For UNDER bets, "UNLIKELY" to hit the line is GOOD, not bad!
- Current logic treats "UNLIKELY" as negative (red color), but for UNDER it should be positive (green)

**Fix:** Invert verdict display logic for UNDER picks:
- UNDER + UNLIKELY to hit line = **SAFE** (green)
- UNDER + CAN_MEET line = **RISKY** (red/yellow)

---

## Implementation Plan

### Phase 1: Fix Production Rate Calculation (Critical)

**File: `src/hooks/useDeepSweetSpots.ts`**

```text
Lines 155-158: Replace average-of-rates with total/total calculation

Before:
const statPerMinute = validLogs.reduce((sum, log) => {
  const stat = log[field as keyof GameLog] as number;
  return sum + (stat / (log.minutes_played || 1));
}, 0) / validLogs.length;

After:
const totalStats = validLogs.reduce((sum, log) => {
  return sum + (log[field as keyof GameLog] as number);
}, 0);
const totalMinutes = validLogs.reduce((sum, log) => {
  return sum + (log.minutes_played || 0);
}, 0);
const statPerMinute = totalMinutes > 0 ? totalStats / totalMinutes : 0;
```

---

### Phase 2: Add Side-Aware Verdict Display

**File: `src/components/sweetspots/ProductionRateDisplay.tsx`**

Update the display to show different labels based on pick side:

| Original Verdict | OVER Display | UNDER Display |
|------------------|--------------|---------------|
| CAN_MEET | ✓ Can Hit (green) | ⚠ Likely Hits (red) |
| RISKY | ⚠ Risky (yellow) | ~ Marginal (yellow) |
| UNLIKELY | ✗ Unlikely (red) | ✓ Safe Floor (green) |

Add `side` prop to the component interface.

---

### Phase 3: Add Context to Floor Protection Bar

**File: `src/components/sweetspots/FloorProtectionBar.tsx`**

- Change label from "Floor Protection" to "Floor Protection" (over) or "Ceiling Risk" (under)
- Add `side` prop
- For UNDER: Invert the color logic (low ceiling risk = green)

---

### Phase 4: Update SweetSpotCard to Pass Side

**File: `src/components/sweetspots/SweetSpotCard.tsx`**

Pass `side={spot.side}` to both:
- `<ProductionRateDisplay />`
- `<FloorProtectionBar />`

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useDeepSweetSpots.ts` | Fix production rate calculation (total/total) |
| `src/components/sweetspots/ProductionRateDisplay.tsx` | Add side-aware verdict labels and colors |
| `src/components/sweetspots/FloorProtectionBar.tsx` | Add side prop, change label for UNDER |
| `src/components/sweetspots/SweetSpotCard.tsx` | Pass side prop to child components |
| `src/types/sweetSpot.ts` | Add component prop interfaces if needed |

---

## Expected Results After Fix

For the **3PT UNDER 1.5** example from screenshot:
- **Production rate**: Will recalculate using correct total/total method
- **Minutes needed**: Will update based on corrected rate
- **Verdict**: Will show "✓ Safe Floor" in GREEN (not red "UNLIKELY")
- **Floor/Ceiling label**: Will show "Ceiling Risk" with inverted color logic

---

## Technical Details

### Correct Production Rate Formula

```
statPerMinute = SUM(all_stats_in_L10) / SUM(all_minutes_in_L10)
```

This is the weighted average that accounts for varying game lengths and gives a true production rate.

### Side-Aware Verdict Mapping

```typescript
function getVerdictDisplay(verdict: MinutesVerdict, side: PickSide) {
  if (side === 'under') {
    // Invert for UNDER picks
    if (verdict === 'UNLIKELY') return { label: 'Safe Floor', color: 'green' };
    if (verdict === 'RISKY') return { label: 'Marginal', color: 'yellow' };
    return { label: 'Likely Hits', color: 'red' };
  }
  // Normal for OVER picks
  if (verdict === 'CAN_MEET') return { label: 'Can Hit', color: 'green' };
  if (verdict === 'RISKY') return { label: 'Risky', color: 'yellow' };
  return { label: 'Unlikely', color: 'red' };
}
```
