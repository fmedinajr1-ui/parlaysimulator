

# Fix Floor Protection Display for Values > 100%

## The Problem

When floor protection exceeds 100% (e.g., L10 Min = 2, Line = 0.5 → ratio = 4.0 = 400%), the display shows "400% Coverage" which is confusing and doesn't make intuitive sense.

**Current Display:**
- L10 Min: 2 | Line: 0.5
- Shows: "400% Coverage"
- This is mathematically correct but misleading

**Expected Display:**
- L10 Min: 2 | Line: 0.5  
- Should show: "100% (4x Floor)" or "100%+ Coverage"
- Indicates the floor completely covers the line AND shows the multiplier

---

## Root Cause

In `FloorProtectionBar.tsx`, line 25:
```typescript
const percentage = Math.round(floorProtection * 100);
```

This doesn't cap the percentage, so 4.0 becomes 400%.

---

## Solution

### File: `src/components/sweetspots/FloorProtectionBar.tsx`

Update the display logic to:
1. **Cap the percentage display at 100%** for floor protection bar
2. **Show a multiplier indicator** when floor exceeds line (e.g., "4x Floor" or "2x Safe")
3. **Make the message clearer** - "Full Coverage (4x)" instead of "400% Coverage"

```typescript
// Line 25 - Change percentage calculation
const rawRatio = floorProtection;
const percentage = Math.min(Math.round(rawRatio * 100), 100); // Cap at 100%
const floorMultiplier = rawRatio >= 1.0 ? Math.round(rawRatio * 10) / 10 : null; // e.g., 4.0x

// Line 91-92 - Update display text
<span className={cn("text-sm font-bold", getTextColorClass())}>
  {floorMultiplier && floorMultiplier > 1 
    ? `Full Coverage (${floorMultiplier}x)`
    : `${percentage}% Coverage`
  }
</span>
```

### Compact Mode Fix

Also update the compact display (line 55-57):
```typescript
<span className={cn("text-xs font-mono font-bold", getTextColorClass())}>
  {floorMultiplier && floorMultiplier > 1 
    ? `${floorMultiplier}x` 
    : `${percentage}%`
  }
</span>
```

---

## Display Examples After Fix

| L10 Min | Line | Ratio | Current Display | New Display |
|---------|------|-------|-----------------|-------------|
| 2 | 0.5 | 4.0 | 400% Coverage | Full Coverage (4x) |
| 3 | 1.5 | 2.0 | 200% Coverage | Full Coverage (2x) |
| 5 | 4.5 | 1.1 | 111% Coverage | Full Coverage (1.1x) |
| 4 | 5.5 | 0.73 | 73% Coverage | 73% Coverage |
| 2 | 4.5 | 0.44 | 44% Coverage | 44% Coverage |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/sweetspots/FloorProtectionBar.tsx` | Cap percentage at 100%, add multiplier display for values > 1.0 |

