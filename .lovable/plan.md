
# v8.0 Deep Sweet Spots Dashboard Implementation

## Overview

I will create a comprehensive **Deep Sweet Spots Dashboard** at `/sweet-spots` that cross-references book lines from `unified_props` against L10 player performance from `nba_player_game_logs` to identify TRUE value picks where the player's historical floor exceeds the betting line.

---

## Files to Create

### 1. Type Definitions
**`src/types/sweetSpot.ts`**
- `DeepSweetSpot` interface with floor protection, edge, production rate, H2H data
- `QualityTier`: ELITE | PREMIUM | STRONG | STANDARD | AVOID
- `MinutesVerdict`: CAN_MEET | RISKY | UNLIKELY  
- `MomentumTier`: HOT | NORMAL | COLD
- `PropType`: points | assists | threes | blocks
- `SweetSpotStats` summary interface

### 2. Core Data Hook
**`src/hooks/useDeepSweetSpots.ts`**

Data pipeline:
1. Fetch live lines from `unified_props` using Eastern date UTC boundaries
2. Fetch L10 game logs from `nba_player_game_logs` for each player
3. Calculate metrics:
   - Floor Protection: `L10_min / line` (1.0+ = ELITE)
   - Edge: `L10_avg - line` for OVERS
   - Hit Rate: Games hitting line / 10
   - Production Rate: `stat / minutes_played`
   - Minutes Verdict: `line / production_rate` vs `avg_minutes`
4. Query `matchup_history` for H2H opponent data
5. Apply v8.0 scoring formula and classify quality tier

**Scoring Formula:**
```
sweet_spot_score = 
  (floor_protection * 0.25) +
  (edge_normalized * 0.20) +
  (hit_rate_l10 * 0.25) +
  (usage_boost * 0.10) +
  (juice_value * 0.10) +
  (h2h_boost * 0.10)
```

### 3. UI Components
**`src/components/sweetspots/`** directory:

| Component | Purpose |
|-----------|---------|
| `QualityTierBadge.tsx` | ELITE (purple), PREMIUM (teal), STRONG (green), STANDARD (gray), AVOID (red) with icons |
| `FloorProtectionBar.tsx` | Visual progress bar showing L10 min vs line coverage with color coding |
| `JuiceIndicator.tsx` | Green (+money value), Gray (light juice), Orange (medium), Red (heavy trap) |
| `MinutesVerdictBadge.tsx` | CAN_MEET (green checkmark), RISKY (yellow warning), UNLIKELY (red X) |
| `MomentumIndicator.tsx` | HOT (flame icon), NORMAL (steady), COLD (snowflake) based on L5/L10 ratio |
| `ProductionRateDisplay.tsx` | Shows stat/minute rate and minutes needed to hit line |
| `SweetSpotCard.tsx` | Main card combining all metrics with Add to Builder button |

### 4. Dashboard Page
**`src/pages/SweetSpots.tsx`**

Layout structure:
- **Header**: Back button, title "Deep Sweet Spots", date display, refresh button
- **Summary Stats Row**: Total picks, ELITE count, PREMIUM count, unique teams
- **Prop Type Tabs**: All | Points | Assists | Threes | Blocks
- **Quality Filters**: ELITE Only | PREMIUM+ | STRONG+ | All
- **Sort Controls**: Score | Floor | Edge | Juice
- **Pick Grid**: Responsive 1-2 column grid of SweetSpotCard components
- **Integration**: Add to parlay builder functionality

---

## Files to Modify

### `src/App.tsx`
- Add lazy import for SweetSpots page
- Add route: `<Route path="/sweet-spots" element={<SweetSpots />} />`

---

## Technical Details

### Quality Tier Classification
| Tier | Criteria |
|------|----------|
| **ELITE** | L10 min >= line AND 100% hit rate |
| **PREMIUM** | L10 min >= line OR 90%+ hit rate with positive edge |
| **STRONG** | 80-89% hit rate with positive edge |
| **STANDARD** | 70-79% hit rate |
| **AVOID** | Negative edge OR <70% hit rate |

### Prop Type Configuration
| Prop Type | Game Log Field | Matchup Key |
|-----------|----------------|-------------|
| points | `points` | `player_points` |
| assists | `assists` | `player_assists` |
| threes | `threes_made` | `player_threes` |
| blocks | `blocks` | `player_blocks` |

### UNDER Pick Handling
For UNDER picks, calculations are inverted:
- Floor Protection: `1.0` if `L10_max <= line`
- Edge: `line - L10_avg` (positive = good for under)

### Juice Analysis
- Plus money (+100+): Maximum value boost (+0.15)
- Light juice (-110 to -120): Neutral
- Medium juice (-121 to -140): Slight penalty (-0.05)
- Heavy juice (-141+): Trap indicator (-0.10)

### Minutes Verdict Logic
```
mins_needed = line / production_rate
CAN_MEET: mins_needed <= avg_minutes * 0.9
RISKY: mins_needed <= avg_minutes * 1.1
UNLIKELY: mins_needed > avg_minutes * 1.1
```

---

## Data Flow

```
useDeepSweetSpots
    │
    ├──→ unified_props (today's lines via UTC boundaries)
    │       └──→ player_name, prop_type, current_line, over_price, under_price, game_description
    │
    ├──→ nba_player_game_logs (L10 for each player)
    │       ├──→ points, assists, threes_made, blocks
    │       ├──→ minutes_played (for production rate)
    │       └──→ usage_rate (for volume boost)
    │
    ├──→ matchup_history (H2H vs opponent)
    │       └──→ avg_stat, min_stat, max_stat, games_played
    │
    └──→ Combine, score, and classify
            │
            └──→ DeepSweetSpot[] sorted by quality tier
```

---

## Expected Results

Based on the earlier data analysis, the dashboard will surface picks like:

**ELITE Tier (100% Floor Protection):**
- Bam Adebayo O 20.5 PTS (L10 min: 20, avg: 24.1)
- Myles Turner O 14.5 PTS (L10 min: 17, avg: 17.9)
- Luka Doncic O 3.5 3PT (L10 min: 3, avg: 4.3)

**PREMIUM Tier (85%+ with positive edge):**
- James Harden O 7.5 AST (L10 min: 6, avg: 8.6)
- Coby White O 2.5 3PT (L10 avg: 3.7)

---

## Implementation Order

1. Create type definitions (`src/types/sweetSpot.ts`)
2. Create core hook (`src/hooks/useDeepSweetSpots.ts`)
3. Create UI components in `src/components/sweetspots/`
4. Create dashboard page (`src/pages/SweetSpots.tsx`)
5. Update App.tsx with route
