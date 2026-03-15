

# Verification Results: Live Quarter Score Progression

## Status: Correctly Implemented with Minor Gaps

The feature is properly built and wired. Here's what was verified:

### Working correctly
- **QuarterBreakdown UI**: Pulsing ring (`animate-pulse` + green ring) on the active quarter, actuals shown below averages with green/red color-coding, live clock display, cumulative progress bar — all implemented correctly
- **Data polling**: `quarter_player_snapshots` queried every 30 seconds by event ID
- **LiveQuarterMap construction**: Correctly maps player name → prop type → [q1, q2, q3, q4] actuals
- **Database**: 157 snapshots exist (from a past game), 688 quarter baselines for historical averages

### Three issues to fix

1. **Missing `steals` and `blocks` in propKeys mapping** — `WarRoomLayout.tsx` line 153 only maps `points`, `assists`, `rebounds`, `threes`. The snapshot table has `steals` and `blocks` columns but they're not wired. Quick 2-line addition.

2. **Wrong game matching for current quarter** — Line 270 uses `games.find(g => g.status === 'in_progress')` which grabs the *first* live game, not the one matching the selected event. Should match on `gameContext.eventId` or team names to get the correct period/clock.

3. **No live snapshots for current games** — The existing 157 snapshots are from Feb 20. The live overlay will only appear if `quarter_player_snapshots` is populated during today's active game by whatever process captures them (the `sync-live-scores` or a separate snapshot function). If that process isn't running, the pulsing indicators and actuals won't show.

### Recommended fixes

| Fix | File | Effort |
|-----|------|--------|
| Add `steals` and `blocks` to propKeys | `WarRoomLayout.tsx` line 153 | 2 lines |
| Match game by eventId/teams instead of first in-progress | `WarRoomLayout.tsx` line 270 | 3 lines |
| Verify snapshot capture runs during live games | Edge function / cron check | Investigation |

