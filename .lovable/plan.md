

## Fix: Pass eventId to LockModeTab

### Problem

The Live Line Scanner in Lock Mode isn't showing because `eventId` is not being passed to the `LockModeTab` component. The scanner has this check:

```typescript
{ enabled: slip.isValid && !!eventId }
```

Since `eventId` is undefined, the scanner never activates.

### Solution

Pass the `eventId` from `gameContext` to the `LockModeTab` component in `ScoutAutonomousAgent.tsx`.

### File to Modify

| File | Line | Change |
|------|------|--------|
| `src/components/scout/ScoutAutonomousAgent.tsx` | ~925-930 | Add `eventId` prop |

### Code Change

**Before:**
```tsx
<LockModeTab
  edges={state.activePropEdges}
  playerStates={state.playerStates}
  gameTime={state.currentGameTime || ''}
  isHalftime={state.halftimeLock.isLocked}
/>
```

**After:**
```tsx
<LockModeTab
  edges={state.activePropEdges}
  playerStates={state.playerStates}
  gameTime={state.currentGameTime || ''}
  isHalftime={state.halftimeLock.isLocked}
  eventId={gameContext.eventId}
/>
```

### Result

After this fix, you'll see:
- "Lines refresh every 30s" indicator in the Lock Mode header
- **Book Line** values on each leg card showing the current live line
- **Line movement** arrows (↑/↓) when the book line changes
- **Timing badges**: BET NOW (green), WAIT (amber), or AVOID (red)
- **Trap warnings** if suspicious line movement is detected
- A "Refresh Now" button to manually trigger a line scan

