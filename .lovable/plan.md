

# Fix: Alt Lines Never Fire (Circular Dependency)

## Root Cause
`useLiveSweetSpotLines` (line 73) filters spots by `s.liveData?.isLive`, but the input spots are raw database records that don't have `liveData` yet. The `liveData` property is only added by `useSweetSpotLiveData` — the very hook that calls `useLiveSweetSpotLines`. This creates a chicken-and-egg problem where `liveSpots` is **always empty**, so `fetch-batch-odds` is never called.

## Fix

### `src/hooks/useLiveSweetSpotLines.ts`
Remove the `liveData?.isLive` gate. Instead, fetch lines for **all** spots when enabled. The hook already has caching and adaptive polling to manage load.

Change line 73-74 from:
```ts
const liveSpots = useMemo(() => {
  return spots.filter(s => s.liveData?.isLive || s.liveData?.gameStatus === 'halftime');
}, [spots]);
```
To:
```ts
const liveSpots = useMemo(() => spots, [spots]);
```

Then update all references throughout the hook — the `fetchAllLines` function, the interval effect, and the return value — to use `spots` / `spots.length` directly since `liveSpots` is now just `spots`.

This single change unblocks the entire Alt Line pipeline. The edge function is deployed and working; the UI columns are ready. The only issue was this filter preventing any API calls from being made.

