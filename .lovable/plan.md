

# Sweet Spots Dashboard Enhancement: Duplicate Removal, Cron Refresh, Live Data & Pace-Based Hedging

## Overview

This plan enhances the Deep Sweet Spots Dashboard (`/sweet-spots`) with four major improvements:
1. **Remove duplicate props** - Deduplicate sweet spots by player+propType to prevent showing the same pick multiple times
2. **Cron job for post-game refresh** - Automatically verify and refresh sweet spot data after games finish
3. **Live data integration** - Add real-time player stats to each card using the unified-player-feed API
4. **Pace-based hedge recommendations** - Real-time hedging suggestions based on game pace and player performance

---

## Phase 1: Remove Duplicates

### Problem
Currently, the `useDeepSweetSpots` hook may return multiple entries for the same player+propType combination if multiple bookmakers have lines for that prop.

### Solution
Add deduplication logic to keep only the best line (highest floor protection or best juice) per player+propType.

**Modify: `src/hooks/useDeepSweetSpots.ts`**

```text
After building spots array, add deduplication:

1. Group spots by unique key: `${playerName}|${propType}`
2. For each group, keep the spot with:
   - Highest floorProtection (primary)
   - Highest sweetSpotScore (tiebreaker)
3. Return deduplicated array
```

### Implementation Detail
```typescript
// After spots.push() loop, before sorting:
const uniqueSpots = new Map<string, DeepSweetSpot>();
for (const spot of spots) {
  const key = `${spot.playerName.toLowerCase()}|${spot.propType}`;
  const existing = uniqueSpots.get(key);
  if (!existing || 
      spot.floorProtection > existing.floorProtection ||
      (spot.floorProtection === existing.floorProtection && spot.sweetSpotScore > existing.sweetSpotScore)) {
    uniqueSpots.set(key, spot);
  }
}
const dedupedSpots = Array.from(uniqueSpots.values());
```

---

## Phase 2: Cron Job for Post-Game Data Refresh

### Goal
Automatically:
1. Verify sweet spot outcomes after games end
2. Refresh game logs with final stats
3. Update accuracy metrics

### New Cron Job: `refresh-sweet-spots-post-game`

**Create: `supabase/functions/refresh-sweet-spots-post-game/index.ts`**

This edge function will:
1. Check for games that finished in the last 2 hours
2. Trigger `backfill-player-stats` for those game dates
3. Run `verify-sweet-spot-outcomes` for settled games
4. Log results to `cron_job_history`

**Cron Schedule SQL (to run via database):**
```sql
-- Run every 30 minutes from 9 PM to 2 AM ET (when games typically finish)
select cron.schedule(
  'refresh-sweet-spots-post-game',
  '*/30 1-7 * * *',  -- UTC: 1-7 AM = 8 PM - 2 AM ET
  $$
  select net.http_post(
    url:='https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/refresh-sweet-spots-post-game',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer <anon_key>"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
```

### Edge Function Logic
```text
1. Query live_game_scores for games with game_status = 'final' 
   updated in last 2 hours
2. For each finished game:
   - Get player names from game
   - Trigger backfill-player-stats for today's date
3. After backfill complete:
   - Call verify-sweet-spot-outcomes for today
4. Log to cron_job_history with:
   - games_processed
   - players_updated
   - outcomes_verified
```

**Update: `supabase/config.toml`**
```toml
[functions.refresh-sweet-spots-post-game]
verify_jwt = false
```

---

## Phase 3: Live Data Integration on Cards

### Goal
Show real-time player stats directly on each SweetSpotCard during live games:
- Current stat value
- Projected final
- Game progress
- Pace indicator
- Risk flags (blowout, foul trouble)

### New Types

**Modify: `src/types/sweetSpot.ts`**

Add live data interface:
```typescript
export interface LivePropData {
  isLive: boolean;
  currentValue: number;
  projectedFinal: number;
  gameProgress: number; // 0-100
  period: string;
  clock: string;
  confidence: number;
  riskFlags: string[];
  trend: 'up' | 'down' | 'stable';
  minutesPlayed: number;
  ratePerMinute: number;
  paceRating: number; // Game pace relative to league average
}

// Update DeepSweetSpot to include optional live data
export interface DeepSweetSpot {
  // ... existing fields ...
  liveData?: LivePropData;
}
```

### New Hook: `useSweetSpotLiveData`

**Create: `src/hooks/useSweetSpotLiveData.ts`**

This hook:
1. Takes an array of DeepSweetSpot
2. Uses `useUnifiedLiveFeed` to get real-time projections
3. Returns enriched spots with live data attached

```typescript
export function useSweetSpotLiveData(spots: DeepSweetSpot[]) {
  const { games, findPlayer, getPlayerProjection } = useUnifiedLiveFeed({
    enabled: spots.length > 0,
    refreshInterval: 15000, // 15s refresh
  });
  
  return useMemo(() => {
    if (!games.length) return spots;
    
    return spots.map(spot => {
      const result = findPlayer(spot.playerName);
      if (!result) return spot;
      
      const { player, game } = result;
      const projection = getPlayerProjection(spot.playerName, spot.propType);
      
      return {
        ...spot,
        liveData: {
          isLive: game.status === 'in_progress',
          currentValue: projection?.current ?? 0,
          projectedFinal: projection?.projected ?? 0,
          gameProgress: game.gameProgress,
          period: String(game.period),
          clock: game.clock || '',
          confidence: projection?.confidence ?? 50,
          riskFlags: player.riskFlags,
          trend: projection?.trend ?? 'stable',
          minutesPlayed: player.minutesPlayed,
          ratePerMinute: projection?.ratePerMinute ?? 0,
          paceRating: game.pace,
        }
      };
    });
  }, [spots, games, findPlayer, getPlayerProjection]);
}
```

### Update SweetSpotCard Component

**Modify: `src/components/sweetspots/SweetSpotCard.tsx`**

Add live data section when game is in progress:

```tsx
{spot.liveData?.isLive && (
  <div className="p-2 bg-green-500/10 rounded-lg border border-green-500/30">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="animate-pulse w-2 h-2 bg-green-500 rounded-full" />
        <span className="text-xs text-green-400 font-medium">LIVE</span>
        <span className="text-xs text-muted-foreground">
          Q{spot.liveData.period} {spot.liveData.clock}
        </span>
      </div>
      <span className="text-sm font-bold">
        {spot.liveData.currentValue} → {spot.liveData.projectedFinal}
      </span>
    </div>
    
    {/* Progress bar */}
    <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
      <div 
        className="h-full bg-green-500 transition-all"
        style={{ width: `${spot.liveData.gameProgress}%` }}
      />
    </div>
    
    {/* Risk flags */}
    {spot.liveData.riskFlags.length > 0 && (
      <div className="mt-2 flex gap-1">
        {spot.liveData.riskFlags.map(flag => (
          <span key={flag} className="text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">
            {flag === 'foul_trouble' ? '⚠️ Foul Trouble' : 
             flag === 'blowout' ? '📉 Blowout' : flag}
          </span>
        ))}
      </div>
    )}
  </div>
)}
```

---

## Phase 4: Pace-Based Hedge Recommendations

### Goal
Provide real-time hedge suggestions when a prop is at risk based on:
- Current pace vs expected pace
- Game flow (blowout = reduced minutes)
- Player trending below line

### New Component: `HedgeRecommendation`

**Create: `src/components/sweetspots/HedgeRecommendation.tsx`**

This component analyzes live data and recommends hedging when:
1. Player is below pace (projected < line for OVER)
2. Risk flags present (blowout, foul trouble)
3. Game pace is significantly slow (affects volume props)

```tsx
interface HedgeRecommendationProps {
  spot: DeepSweetSpot;
}

export function HedgeRecommendation({ spot }: HedgeRecommendationProps) {
  if (!spot.liveData?.isLive) return null;
  
  const { currentValue, projectedFinal, paceRating, riskFlags, gameProgress } = spot.liveData;
  const isOver = spot.side === 'over';
  
  // Calculate hedge scenarios
  const onPace = isOver ? projectedFinal >= spot.line : projectedFinal <= spot.line;
  const atRisk = !onPace && gameProgress > 25;
  const severeRisk = riskFlags.length > 0 || (isOver && paceRating < 95);
  
  if (!atRisk && !severeRisk) return null;
  
  const hedgeMessage = calculateHedgeMessage(spot);
  
  return (
    <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-yellow-500" />
        <span className="text-xs font-medium text-yellow-400">HEDGE ALERT</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{hedgeMessage}</p>
      
      {/* Pace indicator */}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Game Pace:</span>
        <span className={cn(
          "font-medium",
          paceRating >= 102 ? "text-green-400" : 
          paceRating >= 98 ? "text-yellow-400" : "text-red-400"
        )}>
          {paceRating >= 102 ? 'FAST' : paceRating >= 98 ? 'NORMAL' : 'SLOW'}
          ({paceRating})
        </span>
      </div>
    </div>
  );
}

function calculateHedgeMessage(spot: DeepSweetSpot): string {
  const { liveData, line, side, propType } = spot;
  if (!liveData) return '';
  
  const gap = side === 'over' 
    ? line - liveData.projectedFinal 
    : liveData.projectedFinal - line;
  
  if (liveData.riskFlags.includes('blowout')) {
    return `Blowout detected - player may see reduced 4th quarter minutes. Consider hedging ${side === 'over' ? 'UNDER' : 'OVER'} at current line.`;
  }
  
  if (liveData.riskFlags.includes('foul_trouble')) {
    return `Player in foul trouble - minutes at risk. Monitor closely.`;
  }
  
  if (liveData.paceRating < 95 && side === 'over') {
    return `Slow game pace (${liveData.paceRating}) limiting stat opportunities. Prop trending ${gap.toFixed(1)} below projection.`;
  }
  
  return `Prop trending ${gap.toFixed(1)} ${side === 'over' ? 'below' : 'above'} line. Consider live hedge.`;
}
```

### Add Pace Filter to Dashboard

**Modify: `src/pages/SweetSpots.tsx`**

Add pace-based filter for live games:

```tsx
const [paceFilter, setPaceFilter] = useState<'all' | 'fast' | 'slow' | 'live-only'>('all');

// Apply pace filter
if (paceFilter === 'live-only') {
  filtered = filtered.filter(s => s.liveData?.isLive);
} else if (paceFilter === 'fast') {
  filtered = filtered.filter(s => 
    !s.liveData?.isLive || s.liveData.paceRating >= 102
  );
} else if (paceFilter === 'slow') {
  filtered = filtered.filter(s => 
    s.liveData?.isLive && s.liveData.paceRating < 98
  );
}
```

UI for pace filter:
```tsx
<div className="flex items-center gap-1.5">
  <span className="text-sm text-muted-foreground">Pace:</span>
  {(['all', 'live-only', 'fast', 'slow'] as const).map(filter => (
    <Button
      key={filter}
      size="sm"
      variant={paceFilter === filter ? 'default' : 'outline'}
      onClick={() => setPaceFilter(filter)}
      className="text-xs h-7 px-2"
    >
      {filter === 'all' ? 'All' : 
       filter === 'live-only' ? '🔴 Live' :
       filter === 'fast' ? '🚀 Fast' : '🐢 Slow'}
    </Button>
  ))}
</div>
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/refresh-sweet-spots-post-game/index.ts` | Cron job for post-game data refresh |
| `src/hooks/useSweetSpotLiveData.ts` | Hook to enrich spots with live player projections |
| `src/components/sweetspots/HedgeRecommendation.tsx` | Real-time hedge alert component |
| `src/components/sweetspots/LiveDataOverlay.tsx` | Live stats display on card |

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useDeepSweetSpots.ts` | Add deduplication logic |
| `src/types/sweetSpot.ts` | Add LivePropData interface |
| `src/components/sweetspots/SweetSpotCard.tsx` | Integrate live data display and hedge recommendations |
| `src/pages/SweetSpots.tsx` | Add pace filter and use live data hook |
| `supabase/config.toml` | Add new edge function config |

---

## Data Flow

```text
SweetSpots Page
    │
    ├──→ useDeepSweetSpots() → Fetch & deduplicate static analysis
    │
    ├──→ useSweetSpotLiveData(spots) → Enrich with live projections
    │         │
    │         └──→ useUnifiedLiveFeed (15s refresh)
    │                   │
    │                   └──→ unified-player-feed edge function
    │                             │
    │                             └──→ ESPN Summary API (live boxscores)
    │
    └──→ Render SweetSpotCards with:
              ├──→ Static analysis (floor, edge, juice)
              ├──→ Live data overlay (current/projected)
              └──→ HedgeRecommendation (pace + risk flags)
```

---

## Cron Schedule Summary

| Job Name | Schedule | Purpose |
|----------|----------|---------|
| `refresh-sweet-spots-post-game` | Every 30 min, 9 PM - 2 AM ET | Verify outcomes, refresh game logs |
| `verify-sweet-spot-outcomes` | Daily 6 AM ET (existing) | Settle previous day's picks |

---

## Expected Results

1. **No duplicates** - Each player+propType appears once with best line
2. **Auto-refresh** - Sweet spot accuracy data updates within 30 min of game end
3. **Live tracking** - Real-time stats visible on cards during games
4. **Smart hedging** - Alerts when pace/risk factors threaten the bet

