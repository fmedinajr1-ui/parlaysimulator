

# Fix: Date Click Drawer Not Opening

## Problem

The previous fix added `snapPoints` and a no-op `setActiveSnapPoint={() => {}}` to the `MobileDetailDrawer`. The no-op function prevents the drawer from transitioning to any snap point, so it never visually appears even though its `open` state is `true`.

## Fix

**File**: `src/components/ui/mobile-detail-drawer.tsx` (line 46)

Remove the `snapPoints`, `activeSnapPoint`, and `setActiveSnapPoint` props from the `Drawer` component. These were added to fix a "tab won't go up" issue but the no-op handler broke opening entirely.

Replace:
```tsx
<Drawer open={open} onOpenChange={handleOpenChange} snapPoints={[0.5, 1]} activeSnapPoint={1} setActiveSnapPoint={() => {}}>
```

With:
```tsx
<Drawer open={open} onOpenChange={handleOpenChange}>
```

Also revert the max-height changes that aren't needed without snap points:
- `DrawerContent`: `max-h-[92vh]` back to `max-h-[85vh]`
- Scrollable content div: `max-h-[70vh]` back to `max-h-[60vh]` (a modest increase from original 50vh to address the "won't go up" concern)

This is a 3-line revert in a single file. The drawer will open normally on date click and show the day's parlay details.

