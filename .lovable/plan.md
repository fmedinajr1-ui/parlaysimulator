
# Add Manual Refresh Button to Whale Proxy Dashboard

## Overview

Add a refresh button that triggers the `whale-signal-detector` edge function to generate fresh signals, then updates the UI with the new picks in real-time.

---

## Implementation

### 1. Update `useWhaleProxy` Hook

**File:** `src/hooks/useWhaleProxy.ts`

Add a new state and function to handle triggering the edge function:

```typescript
const [isRefreshing, setIsRefreshing] = useState(false);

// Trigger whale-signal-detector and refresh picks
const triggerRefresh = useCallback(async () => {
  if (isSimulating || isRefreshing) return;
  
  try {
    setIsRefreshing(true);
    
    // Call the whale-signal-detector edge function
    const { data, error } = await supabase.functions.invoke('whale-signal-detector', {
      method: 'POST',
    });
    
    if (error) {
      console.error('Error triggering whale detector:', error);
      toast.error('Failed to refresh signals');
      return;
    }
    
    console.log('Whale detector result:', data);
    
    // Fetch the updated picks
    await fetchRealPicks();
    
    toast.success(`Refreshed: ${data?.signalsGenerated || 0} signals found`);
  } catch (err) {
    console.error('Error in triggerRefresh:', err);
    toast.error('Failed to refresh signals');
  } finally {
    setIsRefreshing(false);
  }
}, [isSimulating, isRefreshing, fetchRealPicks]);
```

Export `isRefreshing` and `triggerRefresh` from the hook.

---

### 2. Update Dashboard Header

**File:** `src/components/whale/WhaleProxyDashboard.tsx`

Add a refresh button next to the "Last update" timestamp in the header:

```tsx
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// In the component, destructure new values:
const { ..., isRefreshing, triggerRefresh } = useWhaleProxy();

// In the header section:
<div className="flex items-center gap-2">
  <div className="text-right text-xs text-muted-foreground">
    Last update: {formatTimeAgo(lastUpdate)}
  </div>
  <Button
    variant="ghost"
    size="icon"
    onClick={triggerRefresh}
    disabled={isRefreshing || isSimulating}
    className="h-8 w-8"
  >
    <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
  </Button>
</div>
```

---

## Visual Design

The refresh button will be:
- A ghost button with the `RefreshCw` icon
- Positioned next to the "Last update" timestamp
- Disabled during refresh (with spinning animation)
- Disabled when simulation mode is active
- Shows success/error toast after completion

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useWhaleProxy.ts` | Add `isRefreshing` state, `triggerRefresh` function, import toast |
| `src/components/whale/WhaleProxyDashboard.tsx` | Add refresh button with icon, import Button and RefreshCw |

---

## User Flow

1. User clicks refresh button
2. Button spins to show loading
3. Edge function runs (generates signals from PP/book divergence)
4. New picks are fetched from database
5. Toast shows success message with signal count
6. UI updates with fresh picks

---

## Technical Notes

- Uses `supabase.functions.invoke()` to call the edge function
- Leverages existing `fetchRealPicks()` after trigger to sync UI
- Toast notifications via `sonner` (already installed)
- Button disabled during simulation mode (mock data doesn't need refresh)
