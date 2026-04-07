

# Fix & Settle Correlation/Team Shift Signals Now

## Two Bugs to Fix

**Bug 1 — Line 111**: `if (playerTimeline.length === 0) continue;` skips correlation signals because their `player_name` is an aggregate like "3 players" which doesn't match any timeline entry.

**Fix**: Allow correlation/team shift signals to pass through:
```typescript
if (playerTimeline.length === 0) {
  if (pred.signal_type !== "team_news_shift" && pred.signal_type !== "correlated_movement") {
    continue;
  }
}
```

**Bug 2 — Line 255**: The settlement handler searches `playerTimeline` (already empty) instead of `timeline` (full event data) when looking up individual players.

**Fix**: Change `playerTimeline.filter(` to `timeline.filter(` on line 255.

## After Deploy: Invoke Immediately

Call the edge function right after deploying to settle the 11 pending records now — not waiting for the next scheduled run.

## Scope
- 1 file edited: `supabase/functions/fanduel-accuracy-feedback/index.ts` (lines 111, 255)
- Immediate invocation after deploy

