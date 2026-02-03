
# Shot Chart Analysis Integration for Live Hedge Recommendations

## Overview

This plan adds **Shot Chart vs. Team Defense** intelligence to the hedge recommendation system. The feature compares a player's shooting tendencies by zone against the opponent's defensive weaknesses in those zones to provide more accurate hedging guidance.

Based on the image reference you shared, we'll create a visual representation showing:
- **Player Shot Chart**: Where the player typically shoots from (paint, mid-range, 3PT zones)
- **Team Defense**: Opponent's defensive efficiency by zone
- **Matchup Grade**: Visual indication of advantage/disadvantage by zone

---

## Phase 1: Database Schema for Shot Chart Data

### New Table: `player_zone_stats`

Stores zone-based shooting percentages and frequency per player.

**Zones:**
- **Restricted Area** (within 4 feet of rim)
- **Paint (Non-RA)** (4-14 feet)  
- **Mid-Range** (14 feet to 3PT line)
- **Corner 3** (left/right corners)
- **Above Break 3** (top of arc)

| Column | Type | Description |
|--------|------|-------------|
| player_name | text | Player identifier |
| season | text | "2024-25" |
| zone | text | 'restricted_area', 'paint', 'mid_range', 'corner_3', 'above_break_3' |
| fga | integer | Field goals attempted |
| fgm | integer | Field goals made |
| fg_pct | numeric | Shooting percentage |
| frequency | numeric | % of total shots from this zone |
| updated_at | timestamp | Last sync time |

### New Table: `team_zone_defense`

Stores team defensive efficiency by zone (how well they defend each area).

| Column | Type | Description |
|--------|------|-------------|
| team_abbrev | text | "BOS", "LAL" etc. |
| season | text | "2024-25" |
| zone | text | Same zones as above |
| opp_fga | integer | Opponent FGA allowed in zone |
| opp_fg_pct | numeric | Opponent FG% allowed |
| league_avg_pct | numeric | League average in zone |
| defense_rating | text | 'elite', 'good', 'average', 'poor', 'weak' |
| rank | integer | 1-30 ranking (1 = best defense) |
| updated_at | timestamp | |

---

## Phase 2: New Edge Function - `fetch-shot-chart-data`

This function will fetch and store zone-based shooting data.

**Data Source Options:**
1. **NBA Stats API** (stats.nba.com) - Has `ShotChartDetail` endpoint with zone breakdowns
2. **ESPN API** - Limited zone data but reliable
3. **Stathead/Basketball Reference** - Requires paid access

**Recommended: NBA Stats API** with fallback to manually curated data for top 100 players.

```text
fetch-shot-chart-data/index.ts

1. Fetch player zone shooting stats from NBA API
2. Parse into zones: restricted_area, paint, mid_range, corner_3, above_break_3
3. Calculate frequency (% of shots from each zone)
4. Store in player_zone_stats table

5. Fetch team defensive zone data
6. Compare to league averages to assign ratings
7. Store in team_zone_defense table
```

**Cron Schedule:** Daily at 6 AM ET (after games complete)

---

## Phase 3: Enhanced Types for Shot Chart Analysis

**Modify: `src/types/sweetSpot.ts`**

Add new interface for shot chart matchup data:

```typescript
export interface ZoneMatchup {
  zone: 'restricted_area' | 'paint' | 'mid_range' | 'corner_3' | 'above_break_3';
  playerFrequency: number; // % of shots from this zone
  playerFgPct: number; // Player's FG% in zone
  defenseRating: 'elite' | 'good' | 'average' | 'poor' | 'weak';
  defenseRank: number; // 1-30
  matchupGrade: 'advantage' | 'neutral' | 'disadvantage';
  impact: number; // -10 to +10 score modifier
}

export interface ShotChartAnalysis {
  playerName: string;
  opponentName: string;
  primaryZone: string; // Where player shoots most
  primaryZonePct: number;
  zones: ZoneMatchup[];
  overallMatchupScore: number; // Weighted sum of zone impacts
  recommendation: string; // "Paint-heavy scorer vs weak interior = BOOST" etc.
}

// Update LivePropData to include shot chart
export interface LivePropData {
  // ... existing fields ...
  shotChartMatchup?: ShotChartAnalysis;
}
```

---

## Phase 4: Shot Chart Analysis Hook

**Create: `src/hooks/useShotChartAnalysis.ts`**

This hook fetches zone matchup data for a player vs opponent:

```typescript
export function useShotChartAnalysis(
  playerName: string,
  opponentAbbrev: string,
  propType: PropType
) {
  // 1. Fetch player zone stats from player_zone_stats
  // 2. Fetch opponent zone defense from team_zone_defense
  // 3. Calculate matchup grades per zone
  // 4. Weight by player's shooting frequency
  // 5. Return overall matchup score and recommendation

  // Only relevant for scoring props (points, threes)
  const isRelevant = ['points', 'threes'].includes(propType);
  
  // Calculate primary zone and matchup
  const analysis = useMemo(() => {
    if (!playerZones || !defenseZones) return null;
    
    // Sort zones by player frequency
    const sorted = playerZones.sort((a, b) => b.frequency - a.frequency);
    const primaryZone = sorted[0];
    
    // Calculate weighted matchup score
    let score = 0;
    const zones: ZoneMatchup[] = [];
    
    for (const pz of playerZones) {
      const dz = defenseZones.find(d => d.zone === pz.zone);
      if (!dz) continue;
      
      // Compare player FG% to opponent's allowed FG%
      // If player shoots better than defense allows = advantage
      const grade = calculateGrade(pz.fg_pct, dz.opp_fg_pct, dz.rank);
      const impact = calculateImpact(grade, pz.frequency);
      
      zones.push({ zone: pz.zone, ...grade, impact });
      score += impact * pz.frequency;
    }
    
    return {
      primaryZone: primaryZone.zone,
      primaryZonePct: primaryZone.frequency,
      zones,
      overallMatchupScore: score,
      recommendation: generateRecommendation(score, primaryZone, propType)
    };
  }, [playerZones, defenseZones]);
  
  return { analysis, isLoading, error };
}
```

---

## Phase 5: Shot Chart Visualization Component

**Create: `src/components/sweetspots/ShotChartMatchup.tsx`**

Visual half-court representation showing:
- Color-coded zones (green = advantage, red = disadvantage)
- Player shot frequency per zone
- Defense rating overlay

```tsx
export function ShotChartMatchup({ analysis }: { analysis: ShotChartAnalysis }) {
  // Half-court SVG with zones
  // Each zone colored by matchup grade
  // Frequency % shown in each zone
  // Defense rank shown on hover
  
  return (
    <div className="relative w-full aspect-[1.2] max-w-[200px]">
      {/* Court SVG background */}
      <svg viewBox="0 0 470 500" className="w-full h-full">
        {/* Paint zone */}
        <rect 
          className={cn(
            "transition-colors",
            getZoneColor(analysis.zones.find(z => z.zone === 'paint')?.matchupGrade)
          )}
          x="170" y="0" width="130" height="190"
        />
        
        {/* Restricted area (arc) */}
        <circle 
          className={cn(
            getZoneColor(analysis.zones.find(z => z.zone === 'restricted_area')?.matchupGrade)
          )}
          cx="235" cy="52" r="40"
        />
        
        {/* Corner 3 zones */}
        <rect 
          className={cn(
            getZoneColor(analysis.zones.find(z => z.zone === 'corner_3')?.matchupGrade)
          )}
          x="0" y="0" width="30" height="140"
        />
        {/* ... right corner, mid-range, above break 3 ... */}
        
        {/* Zone labels with frequency */}
        {analysis.zones.map(zone => (
          <text key={zone.zone} ...>
            {Math.round(zone.playerFrequency * 100)}%
          </text>
        ))}
      </svg>
      
      {/* Legend */}
      <div className="flex gap-2 text-xs mt-2">
        <span className="text-green-400">● Advantage</span>
        <span className="text-yellow-400">● Neutral</span>
        <span className="text-red-400">● Disadvantage</span>
      </div>
    </div>
  );
}
```

---

## Phase 6: Integrate with Hedge Recommendations

**Modify: `src/components/sweetspots/HedgeRecommendation.tsx`**

Add shot chart analysis to the hedge calculation:

```typescript
function calculateHedgeAction(spot: DeepSweetSpot): HedgeAction {
  // ... existing logic ...
  
  // NEW: Shot chart matchup modifier
  const shotChart = spot.liveData?.shotChartMatchup;
  if (shotChart && (spot.propType === 'points' || spot.propType === 'threes')) {
    
    // Strong disadvantage = more urgent hedge
    if (shotChart.overallMatchupScore < -5) {
      return {
        message: `Shot chart mismatch: ${shotChart.recommendation}`,
        action: `📊 ${oppositeSide} ${line} - Player's primary zone (${shotChart.primaryZone}) faces ${getDefenseLabel(shotChart)} defense`,
        urgency: 'high'
      };
    }
    
    // Advantage = less urgent to hedge
    if (shotChart.overallMatchupScore > 5 && !atRisk) {
      // Reduce urgency - good matchup means projection more likely
      urgency = 'low';
    }
  }
  
  // ... rest of existing logic ...
}
```

**Add visual component to HedgeRecommendation:**

```tsx
{/* Shot Chart Section (only for points/threes props) */}
{shotChartMatchup && (
  <div className="mt-3 pt-3 border-t border-border/30">
    <div className="flex items-center gap-2 mb-2">
      <Target className="w-4 h-4 text-muted-foreground" />
      <span className="text-xs font-medium">Shot Chart vs Defense</span>
    </div>
    <div className="flex gap-4 items-start">
      <ShotChartMatchup analysis={shotChartMatchup} />
      <div className="flex-1 text-xs space-y-1">
        <p className="text-muted-foreground">
          Primary Zone: <span className="text-foreground font-medium">
            {formatZoneName(shotChartMatchup.primaryZone)}
          </span>
          ({Math.round(shotChartMatchup.primaryZonePct * 100)}% of shots)
        </p>
        <p className={cn(
          shotChartMatchup.overallMatchupScore > 0 ? "text-green-400" : "text-red-400"
        )}>
          {shotChartMatchup.recommendation}
        </p>
      </div>
    </div>
  </div>
)}
```

---

## Phase 7: Data Flow Summary

```text
Daily Sync (6 AM ET)
    │
    ├──→ fetch-shot-chart-data edge function
    │         │
    │         ├──→ NBA Stats API → player_zone_stats
    │         └──→ Team zone defense → team_zone_defense
    │
    └──→ Data ready for queries

Live Game
    │
    ├──→ useSweetSpotLiveData (existing)
    │         │
    │         └──→ Enriches spots with live stats
    │
    ├──→ useShotChartAnalysis (NEW)
    │         │
    │         ├──→ Query player_zone_stats
    │         ├──→ Query team_zone_defense
    │         └──→ Calculate matchup grades
    │
    └──→ HedgeRecommendation
              │
              ├──→ Existing factors (pace, risk flags, projection)
              └──→ NEW: Shot chart matchup modifier
                        │
                        └──→ Adjust urgency based on zone advantages
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/fetch-shot-chart-data/index.ts` | Daily sync of zone shooting data |
| `src/hooks/useShotChartAnalysis.ts` | Calculate player vs defense zone matchups |
| `src/components/sweetspots/ShotChartMatchup.tsx` | Visual half-court zone display |

## Files to Modify

| File | Change |
|------|--------|
| `src/types/sweetSpot.ts` | Add `ZoneMatchup`, `ShotChartAnalysis` interfaces |
| `src/components/sweetspots/HedgeRecommendation.tsx` | Integrate shot chart analysis into hedge logic |
| `src/hooks/useSweetSpotLiveData.ts` | Enrich with shot chart data |
| `supabase/config.toml` | Add new edge function config |

## Database Migrations

```sql
-- player_zone_stats table
CREATE TABLE player_zone_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  season text NOT NULL DEFAULT '2024-25',
  zone text NOT NULL,
  fga integer DEFAULT 0,
  fgm integer DEFAULT 0,
  fg_pct numeric(5,3),
  frequency numeric(5,3),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(player_name, season, zone)
);

-- team_zone_defense table
CREATE TABLE team_zone_defense (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_abbrev text NOT NULL,
  season text NOT NULL DEFAULT '2024-25',
  zone text NOT NULL,
  opp_fga integer DEFAULT 0,
  opp_fg_pct numeric(5,3),
  league_avg_pct numeric(5,3),
  defense_rating text,
  rank integer,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(team_abbrev, season, zone)
);
```

---

## Expected Impact

1. **Smarter Hedging** - Points/threes props get zone-aware recommendations
2. **Visual Insight** - Users see exactly where matchup advantages/disadvantages exist
3. **Accuracy Boost** - Shot chart context should improve hedge timing by identifying structural mismatches (e.g., "paint scorer vs elite rim protection = lower projection confidence")

---

## Example Output

For a player like **Trae Young O 25.5 PTS** vs Boston:

```
Shot Chart vs Defense
┌────────────────────────────────────┐
│  [2%]     [28%]🟢    [1%]          │  ← Above Break 3
│           ┌─────┐                   │
│  [20%]    │🔴   │    [3%]          │  ← Mid-Range / Paint
│           │     │                   │
│  [24%]🟢  └─────┘    [24%]🟢       │  ← Corner 3 / Restricted
└────────────────────────────────────┘

Primary Zone: Above Break 3 (28%)
🟢 ADVANTAGE: Boston allows 36% from above-break 3 (Rank #22)

Hedge Urgency: REDUCED
Recommendation: Hold position - favorable zone matchup
```
