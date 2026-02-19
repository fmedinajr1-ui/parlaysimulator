

## Fix VOID Badge Bug in DayParlayDetail.tsx

### Problem
Currently, the VOID badge renders whenever a leg has no outcome AND `actual_value` is null:
```tsx
{(!leg.outcome && (parlay.outcome === 'void' || leg.actual_value == null)) ? (
  <span ...>VOID</span>
) : (!leg.outcome && <Clock ... />)}
```
This means any unsettled/pending leg (where stats haven't been fetched yet) incorrectly shows "VOID" instead of a pending clock icon.

### Fix
Change the condition so VOID only appears when the **parlay's** outcome is explicitly `'void'`. Otherwise, show the Clock (pending) icon.

### Code Change (single line group in `DayParlayDetail.tsx`, ~line 196)

**Before:**
```tsx
{(!leg.outcome && (parlay.outcome === 'void' || leg.actual_value == null)) ? (
  <span className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded shrink-0">VOID</span>
) : (!leg.outcome && <Clock className="w-3 h-3 text-muted-foreground shrink-0" />)}
```

**After:**
```tsx
{(!leg.outcome && parlay.outcome === 'void') ? (
  <span className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded shrink-0">VOID</span>
) : (!leg.outcome && <Clock className="w-3 h-3 text-muted-foreground shrink-0" />)}
```

The only change is removing `|| leg.actual_value == null` from the condition. This ensures:
- VOID badge only shows when the parlay itself is voided
- Unsettled legs (no outcome, no actual value yet) correctly show the Clock/pending icon

