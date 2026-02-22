
## Add Hedge Status Accuracy Card to the War Room

### What Changes
Add the existing `HedgeStatusAccuracyCard` component into the War Room's **Hedge Mode** view, right below the `HedgeModeTable`. This gives you real-time visibility into historical hedge performance (OVER vs UNDER hit rates by quarter and status) without leaving the War Room.

### Where It Appears
- Only visible in **Hedge Mode** (not Game Mode) -- keeps Game Mode clean
- Positioned directly below the Hedge Mode Table, above the AI Whisper section

### Implementation (1 file change)

**`src/components/scout/warroom/WarRoomLayout.tsx`**:
1. Import `HedgeStatusAccuracyCard` from `@/components/sweetspots/HedgeStatusAccuracyCard`
2. Inside the Hedge Mode `motion.div` block (lines 360-368), add `<HedgeStatusAccuracyCard />` below `<HedgeModeTable />`

### No Other Changes Needed
- The component is fully self-contained (fetches its own data via the `get_hedge_side_performance` RPC)
- No new props, hooks, or database changes required
- The ALL/OVER/UNDER toggle + quarter tabs + Side Intelligence insights all come along automatically
