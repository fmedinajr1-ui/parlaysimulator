

# Add "MIDDLE" Filter Category for Middle Opportunities

## Overview
Add a dedicated filter button to the Sweet Spots Quality filter row that allows users to quickly see all picks with middle opportunity potential. This makes it easy to find high-value hedge situations without scrolling through all picks.

---

## What Will Change

The existing Quality filter row will get a new "MIDDLE" button with a distinct gold/yellow styling:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ 🔽 Quality:  [All] [ELITE] [PREMIUM+] [STRONG+] [💰 MIDDLE (2)]    │
└─────────────────────────────────────────────────────────────────────┘
```

When selected, only spots with active middle opportunities (line moved ≥2 points) will be shown.

---

## Implementation Details

### 1. Update QualityFilter Type

Add "MIDDLE" to the available filter options:

```typescript
// src/pages/SweetSpots.tsx
type QualityFilter = 'all' | 'ELITE' | 'PREMIUM+' | 'STRONG+' | 'MIDDLE';
```

### 2. Track Middle Opportunity Count

Use the existing `spotsWithLineMovement` from `useSweetSpotLiveData`:

```typescript
// Already returned from useSweetSpotLiveData
const { spots: enrichedSpots, spotsWithLineMovement, liveGameCount } = useSweetSpotLiveData(data?.spots || []);

// Count for button badge
const middleCount = spotsWithLineMovement.length;
```

### 3. Add Filter Logic

Extend the filtering logic to handle MIDDLE filter:

```typescript
// In filteredSpots useMemo
if (qualityFilter === 'MIDDLE') {
  // Get IDs of spots with significant line movement
  const middleIds = new Set(spotsWithLineMovement.map(s => s.id));
  filtered = filtered.filter(s => middleIds.has(s.id));
}
```

### 4. Add MIDDLE Button to Filter Row

Add a new button with distinctive styling (gold/yellow to match the 💰 icon):

```tsx
{/* Existing quality filters */}
{(['all', 'ELITE', 'PREMIUM+', 'STRONG+'] as QualityFilter[]).map(...)}

{/* NEW: Middle opportunity filter */}
{middleCount > 0 && (
  <Button
    size="sm"
    variant={qualityFilter === 'MIDDLE' ? 'default' : 'outline'}
    onClick={() => setQualityFilter('MIDDLE')}
    className={cn(
      "text-xs h-7 px-2 gap-1",
      qualityFilter === 'MIDDLE' && "bg-yellow-600 hover:bg-yellow-700"
    )}
  >
    <DollarSign size={12} />
    MIDDLE ({middleCount})
  </Button>
)}
```

### 5. Add Summary Card for Middle Opportunities (Optional)

Add a new summary card alongside ELITE/PREMIUM/STRONG:

```tsx
{middleCount > 0 && (
  <Card className="bg-yellow-500/10 border-yellow-500/30">
    <CardContent className="p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <DollarSign size={14} className="text-yellow-400" />
        <span className="text-xs text-yellow-300">MIDDLE</span>
      </div>
      <div className="text-2xl font-bold text-yellow-400">
        {middleCount}
      </div>
    </CardContent>
  </Card>
)}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/SweetSpots.tsx` | Add MIDDLE to QualityFilter type, add filter logic, add MIDDLE button with count badge |

---

## Visual Result

**Before:**
```text
Quality: [All] [ELITE] [PREMIUM+] [STRONG+]
```

**After:**
```text
Quality: [All] [ELITE] [PREMIUM+] [STRONG+] [💰 MIDDLE (2)]
                                             └─ Only shows when middle opportunities exist
```

The MIDDLE button will:
- Only appear when there are active middle opportunities (≥1 pick with ±2pt line movement)
- Show the count in parentheses
- Use distinctive gold/yellow coloring to stand out
- Filter to show only those picks with profit-lock potential

---

## How It Works

```text
User Flow:
1. Game is live, Anthony Edwards OVER 28.5 original bet
2. Line drops to 25.5 (−3.0 movement)
3. System detects middle opportunity
4. "💰 MIDDLE (1)" button appears in Quality filter
5. User clicks MIDDLE → sees only picks with profit-lock potential
6. Card shows: "Hedge UNDER 25.5 for guaranteed profit if scores 26-28"
```

