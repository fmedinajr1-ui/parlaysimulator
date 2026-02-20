

## Replace Stream Panel with Live Game Command Center

### What Changes
Replace the "Stream coming soon" video placeholder in the customer Scout view with a rich, animated live game dashboard featuring a scoreboard, live box scores, a half-court shot chart, and a play-by-play feed -- all powered by existing data sources (`useLiveScores`, `useUnifiedLiveFeed`, and the shot chart system).

### What Customers Will See

Instead of a blank video panel, customers get a dynamic "game HQ" with four sections stacked inside the existing card:

1. **Live Scoreboard** -- Animated score with period/clock, pulsing LIVE indicator, and score-change flash effects (reuses `motion` animations from `LiveScoreCard`)
2. **Mini Shot Chart** -- The existing half-court SVG (`ShotChartMatchup`) showing zone advantages/disadvantages for the active game's key players, rendered in compact mode
3. **Live Box Score Table** -- Top 6 players per team with PTS/REB/AST/3PM in a compact scrollable table, auto-updating via polling
4. **Play-by-Play Feed** -- Last 8 plays with play-type icons (dunk, three-pointer, block, steal) and smooth entry animations as new plays arrive

### Implementation

**New Component: `src/components/scout/CustomerLiveGamePanel.tsx`**

A single new component that replaces the static placeholder. It will:
- Accept `homeTeam`, `awayTeam`, and `eventId` from `gameContext`
- Use `useLiveScores({ eventId })` for score, period, clock, quarter scores, and player stats
- Use `useUnifiedLiveFeed({ eventIds: [eventId] })` for projections and recent plays
- Render four sub-sections with framer-motion animations

**File: `src/components/scout/CustomerScoutView.tsx`**

- Import `CustomerLiveGamePanel` 
- Replace the static Stream Panel card (lines 67-82) with `<CustomerLiveGamePanel>`, passing `homeTeam`, `awayTeam`, and `eventId` from `gameContext`
- Keep the fallback "Waiting for game data..." state when no live data exists yet

### Technical Details

**Scoreboard Section:**
- Reuse the score flash animation pattern from `LiveScoreCard` (scale pulse on score change via `motion.p`)
- Show quarter-by-quarter scoring breakdown when available
- Pulsing red dot + "LIVE" badge when `status === 'in_progress'`
- "SCHEDULED" / "FINAL" states handled gracefully

**Shot Chart Section:**
- Import existing `ShotChartMatchup` component in `compact` mode
- Use `useBatchShotChartAnalysis` to get zone matchup data for top scorers
- Show 1-2 key player matchups side by side (space-efficient compact badges)

**Box Score Table:**
- Source from `live_game_scores.player_stats` via `useLiveScores`
- Compact table: Name | PTS | REB | AST | 3PM | MIN
- Separated by team with team name headers
- Top performers highlighted with accent color
- ScrollArea for overflow on mobile

**Play-by-Play Feed:**
- Source from `useUnifiedLiveFeed` `recentPlays` data
- Each play shows: timestamp, play-type icon, description text
- Play-type icon mapping from the existing `RecentPlay.playType` enum (dunk, three_pointer, block, steal, etc.)
- `AnimatePresence` with slide-in animation for new plays
- Auto-scrolls to latest play
- High-momentum plays (dunks, blocks) get a subtle glow effect

**Animations:**
- Score changes: `motion` scale pulse (existing pattern)
- New plays: `fade-in` + `translateY` entrance
- Section transitions: `animate-fade-in` on mount
- High-momentum plays: Brief border glow using `ring-primary/50`

**Data Flow:**
- Both hooks already poll on intervals (30s for live scores, 15s for unified feed)
- Realtime subscription on `live_game_scores` already exists in `useLiveScores`
- No new database tables or edge functions needed

### Files Changed

| File | Change |
|------|--------|
| `src/components/scout/CustomerLiveGamePanel.tsx` | New component with scoreboard, shot chart, box score, and play feed |
| `src/components/scout/CustomerScoutView.tsx` | Replace Stream Panel placeholder with `CustomerLiveGamePanel` |

