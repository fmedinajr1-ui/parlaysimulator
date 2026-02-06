

# Player-Specific Film Learning System

## Overview

You're asking about building a system where AI can learn individual player patterns like:
- When Anthony Edwards shoots 3s most (which quarters, game situations)
- Coach substitution patterns for each player
- Matchup-specific performance (e.g., how Edwards performs vs specific defenders)

This would require combining **film analysis** with **historical data APIs** to create player profiles that get smarter over time.

---

## Data Sources: Film vs APIs

### Film Sources (Video Footage)

| Source | Access | What It Provides |
|--------|--------|------------------|
| **Synergy Sports** | Team-only ($$$) | Player tracking coordinates, play-by-play video clips |
| **Second Spectrum** | NBA/G-League teams only | Ball/player tracking at 25fps, shot probabilities |
| **SportVU** (legacy) | Discontinued | Historical tracking data only |
| **Your uploaded clips** | Free (manual) | Whatever you record from broadcasts |
| **YouTube/Broadcasts** | Legal gray area | General highlights, not structured |

**Reality check**: Official tracking APIs (Synergy, Second Spectrum) are restricted to NBA teams and cost $50K+/year. There is **no public API for NBA game film**.

### Data APIs (Already Integrated)

Your system already uses these APIs for structured data:

| API | What We Get | Player-Specific Data |
|-----|-------------|---------------------|
| **ESPN API** | Live PBP, box scores, substitutions | Yes - real-time stats per player |
| **BallDontLie** | Props, player stats, game logs | Yes - season averages, game-by-game |
| **The Odds API** | Betting lines | Props per player |

---

## What's Already Built in Your System

Your Scout agent already has significant infrastructure:

1. **Vision Analysis** (`scout-agent-loop`)
   - Extracts fatigue, speed, effort signals from uploaded frames
   - Validates jersey numbers against rosters
   - Updates `PlayerLiveState` with accumulating signals

2. **Historical Data**
   - `nba_player_game_logs` - Game-by-game stats for all players
   - `player_zone_stats` - Where each player shoots from
   - `matchup_history` - H2H performance vs opponents
   - `rotation-patterns.ts` - Models when players sit/play

3. **Live Tracking**
   - `fetch-live-pbp` - Real-time ESPN PBP data
   - Substitution detection from PBP events
   - Quarter-by-quarter production tracking

---

## Proposed: Player Behavior Profile System

Combine existing data with optional film uploads to build per-player intelligence that the AI uses for predictions.

### New Database Table: `player_behavior_profiles`

Store learned patterns per player:

```sql
CREATE TABLE public.player_behavior_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  team TEXT,
  
  -- Shooting patterns (from game logs + zone stats)
  three_pt_peak_quarters JSONB,  -- {"q1": 22%, "q2": 18%, "q3": 28%, "q4": 32%}
  scoring_zone_preferences JSONB, -- {"restricted_area": 35%, "corner_3": 22%}
  clutch_performance_vs_average NUMERIC, -- +/- vs regular production in Q4 <5min
  
  -- Rotation patterns (from PBP substitution data)
  avg_first_rest_time TEXT,  -- "Q1 5:30"
  avg_second_stint_start TEXT,
  avg_minutes_per_quarter JSONB,
  blowout_minutes_reduction NUMERIC,
  
  -- Matchup patterns (from historical logs)
  best_matchups JSONB,  -- [{opponent: "LAL", stat: "points", avg_vs: 28.5}]
  worst_matchups JSONB,
  
  -- Film-derived insights (when uploaded)
  fatigue_tendency TEXT,  -- "Shows fatigue in Q3 after high-usage Q1"
  body_language_notes TEXT,
  film_sample_count INTEGER DEFAULT 0,
  
  -- Metadata
  games_analyzed INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now(),
  profile_confidence NUMERIC,  -- 0-100 based on sample size
  
  UNIQUE(player_name, team)
);
```

### Edge Function: `build-player-profile`

Aggregates historical data into profiles:

```typescript
// Runs nightly or on-demand for specific players
async function buildPlayerProfile(playerName: string) {
  // 1. Fetch all game logs for this player
  const gameLogs = await fetchPlayerGameLogs(playerName, 50); // Last 50 games
  
  // 2. Analyze quarter-by-quarter 3PT distribution
  const threesByQuarter = analyzeQuarterDistribution(gameLogs, 'threes_made');
  
  // 3. Analyze substitution patterns from PBP
  const rotationPatterns = await analyzeRotationPatterns(playerName);
  
  // 4. Analyze matchup performance
  const matchupStats = await analyzeMatchupHistory(playerName);
  
  // 5. Calculate clutch performance
  const clutchDelta = analyzeClutchPerformance(gameLogs);
  
  // 6. Merge with any existing film insights
  const existingProfile = await getExistingProfile(playerName);
  
  return {
    player_name: playerName,
    three_pt_peak_quarters: threesByQuarter,
    scoring_zone_preferences: await getZonePreferences(playerName),
    clutch_performance_vs_average: clutchDelta,
    best_matchups: matchupStats.best,
    worst_matchups: matchupStats.worst,
    // Preserve film insights if they exist
    fatigue_tendency: existingProfile?.fatigue_tendency,
    body_language_notes: existingProfile?.body_language_notes,
    film_sample_count: existingProfile?.film_sample_count || 0,
    games_analyzed: gameLogs.length,
  };
}
```

### Film Upload Enhancement

When film is uploaded for a specific player, accumulate insights:

```typescript
// In scout-agent-loop or dedicated analyzer
async function updatePlayerFilmInsights(
  playerName: string,
  visionSignals: VisionSignal[]
) {
  const existing = await getProfile(playerName);
  
  // Aggregate film observations
  const fatigueSignals = visionSignals.filter(s => 
    s.player === playerName && s.signalType === 'fatigue'
  );
  
  // Update profile with film-derived insights
  await supabase.from('player_behavior_profiles').upsert({
    player_name: playerName,
    film_sample_count: (existing?.film_sample_count || 0) + 1,
    fatigue_tendency: deriveFatigueTendency(fatigueSignals, existing),
    // Add other film insights...
  });
}
```

---

## How This Integrates with Predictions

### Current Flow (Before Profile)

```text
1. Get betting line: Edwards O/U 28.5 PTS
2. Check L10 median: 26.2 PTS
3. Check zone matchup vs opponent: +5 edge
4. Predict: 27.5 expected → Slight UNDER lean
```

### Enhanced Flow (With Profile)

```text
1. Get betting line: Edwards O/U 28.5 PTS vs Lakers
2. Check L10 median: 26.2 PTS
3. Check zone matchup: +5 edge
4. Load profile insights:
   - Q3/Q4 are his peak 3PT quarters (+32% of 3PM)
   - Historical vs Lakers: 31.2 avg (+5 vs normal)
   - Film insight: Showed strong effort in recent uploads
5. Adjust prediction: 29.8 expected → OVER lean
```

---

## Data Collection Strategy (No API Required)

Since official film APIs aren't available, here's how to build profiles:

### 1. Structured Data (Automated - Already Possible)

| Data Point | Source | Update Frequency |
|------------|--------|------------------|
| Quarter-by-quarter stats | ESPN PBP during live games | Real-time |
| Substitution timing | ESPN PBP substitution events | Real-time |
| Zone shooting | `player_zone_stats` table | Daily |
| Matchup history | Game logs cross-referenced | Daily |
| Season averages | BallDontLie | Daily |

### 2. Film Upload (Manual - Enhanced Value)

When you upload clips:
- AI extracts player-specific signals (fatigue, effort, speed)
- Links observations to the player's profile
- Accumulates insights over time ("Edwards shows fatigue in back-to-backs")

---

## Implementation Files

| File | Purpose |
|------|---------|
| `supabase/migrations/xxx_player_behavior_profiles.sql` | Create profiles table |
| `supabase/functions/build-player-profile/index.ts` | Aggregate stats into profiles |
| `supabase/functions/scout-agent-loop/index.ts` | Update film insights on upload |
| `src/hooks/usePlayerProfile.ts` | Fetch profile data for UI |
| `src/components/scout/PlayerProfileCard.tsx` | Display learned patterns |
| `supabase/functions/category-props-analyzer/index.ts` | Use profiles in predictions |

---

## What Film Adds vs Data Alone

| Insight Type | From Data APIs | From Film |
|--------------|----------------|-----------|
| When player shoots 3s | Partial (quarter totals) | Visual confirmation |
| Substitution patterns | Yes (PBP events) | Visual on bench cues |
| Defense matchups | Yes (opponent stats) | Actual defensive effort |
| Fatigue signs | No | Hands on knees, slow recovery |
| Body language | No | Frustration, energy, focus |
| Shot mechanics | No | Form breakdown under fatigue |
| Coach interactions | No | Timeout instructions, benching cues |

**Bottom line**: Data APIs give you ~70% of what you need. Film adds the remaining 30% - specifically the behavioral/visual cues that don't show up in box scores.

---

## Recommended Approach

### Phase 1: Profile from Data (No Film Required)
1. Create `player_behavior_profiles` table
2. Build `build-player-profile` edge function using existing data
3. Run nightly for all NBA players
4. Integrate profiles into `category-props-analyzer` predictions

### Phase 2: Film Enhancement (Optional)
1. Modify `scout-agent-loop` to update profiles with film insights
2. Store accumulated observations per player
3. Weight film insights based on recency and sample size

### Phase 3: Profile-Based Predictions
1. Show player profile on Sweet Spots cards
2. Use profile data to adjust confidence scores
3. Track which profile factors predict outcomes best

---

## Summary

| Question | Answer |
|----------|--------|
| Is there an API for NBA film? | No - Synergy/Second Spectrum are team-only ($50K+/year) |
| Can we build player profiles without film? | Yes - using game logs, PBP, and zone stats |
| Does film add value? | Yes - fatigue, body language, and visual cues not in box scores |
| Effort to implement? | Phase 1 (data-only): 2-3 days. Phase 2 (film): +1-2 days |

This system would let the AI "know" each player's tendencies and use that knowledge to improve predictions - even without official video APIs.

