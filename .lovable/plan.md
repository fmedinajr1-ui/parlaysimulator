

# Enhanced Film Analysis: Player Tracking with Jersey, Rotation, Shot Chart & Defensive Matchups

## Overview

Reconfigure the Film Profile Upload to perform detailed player tracking when analyzing video. When users select players, the AI vision system will watch the footage and extract:

1. **Jersey identification & placement** - Track player positions on court
2. **Rotation patterns** - Stints, rest times, substitution behavior  
3. **Shot chart data** - Shooting locations, attempts, makes
4. **Defensive matchups** - Who they guard, positioning

This enriches `player_behavior_profiles` with actionable film-derived insights that feed into Sweet Spots predictions.

---

## What Changes

### Current Flow
```text
YouTube Link → Extract Frames → Generic Fatigue/Body Language Analysis → Update Profile
```

### New Flow
```text
YouTube Link → Extract Frames → ENHANCED TRACKING ANALYSIS:
  ├─ Jersey ID & Court Position Mapping
  ├─ Shot Attempts & Locations (zone classification)
  ├─ Rotation/Stint Patterns
  └─ Defensive Assignment Detection
                ↓
        Update Profile with Structured Data
```

---

## Technical Implementation

### 1. Enhanced AI Prompt for `analyze-game-footage`

Update the edge function to request structured tracking data for selected players:

**New Analysis Categories:**
| Category | Data Captured | Profile Field |
|----------|---------------|---------------|
| **Jersey Tracking** | Jersey #, frames detected, court zone | `body_language_notes` (structured) |
| **Rotation** | Stint count, bench time, sub patterns | `avg_first_rest_time`, `avg_second_stint_start` |
| **Shot Chart** | Zone (restricted, paint, mid, corner3, above3), attempts, makes | `scoring_zone_preferences` |
| **Defensive Matchup** | Opponent guarded, closeout quality | `best_matchups`/`worst_matchups` |

**New AI Prompt Structure:**
```typescript
const trackingPrompt = `
For EACH selected player (${selectedPlayerNames.join(', ')}), provide detailed tracking:

1. JERSEY & PLACEMENT
   - Jersey number confirmed
   - Court zones observed: paint, perimeter, corner, transition
   - Frames where player is visible

2. SHOT ATTEMPTS (if visible)
   - Zone: restricted_area | paint | mid_range | corner_3 | above_break_3
   - Result: made | missed | blocked
   - Shot type: catch_shoot | pull_up | post_up | transition

3. ROTATION SIGNALS
   - On/off court patterns
   - Bench time indicators
   - Fatigue upon re-entry

4. DEFENSIVE MATCHUPS
   - Opponent player guarded (if identifiable)
   - Closeout quality: 1-10
   - Help rotation timing: quick | average | slow

Return JSON with this structure:
{
  "playerTracking": [
    {
      "playerName": "Jalen Brunson",
      "jerseyNumber": "11",
      "framesDetected": [0, 3, 5, 8, 12],
      "courtZones": {
        "paint": 4,
        "perimeter": 6,
        "corner": 2,
        "transition": 3
      },
      "shotAttempts": [
        { "zone": "mid_range", "result": "made", "type": "pull_up" },
        { "zone": "paint", "result": "missed", "type": "post_up" }
      ],
      "rotationSignals": {
        "stintsObserved": 1,
        "benchTimeVisible": false,
        "fatigueOnReentry": "none"
      },
      "defensiveMatchups": [
        { "opponent": "Cade Cunningham", "closeoutQuality": 7, "helpTiming": "quick" }
      ],
      "movementScore": 8,
      "fatigueIndicators": ["none"],
      "confidence": "high"
    }
  ]
}
`;
```

### 2. Update `FilmProfileUpload.tsx` Profile Update Logic

When the AI returns tracking data, map it to profile fields:

```typescript
// Process enhanced tracking data for each player
for (const player of selectedPlayers) {
  const tracking = findPlayerTracking(analysisData.playerTracking, player.player_name);
  
  if (!tracking) continue;
  
  // A. Build shot chart zone preferences
  const zonePreferences: Record<string, number> = {};
  if (tracking.shotAttempts?.length > 0) {
    tracking.shotAttempts.forEach((shot: any) => {
      zonePreferences[shot.zone] = (zonePreferences[shot.zone] || 0) + 1;
    });
  }
  
  // B. Build rotation timing data
  let avgFirstRest = existingProfile?.avg_first_rest_time;
  let avgSecondStint = existingProfile?.avg_second_stint_start;
  if (tracking.rotationSignals?.benchTimeVisible) {
    // Append observation to rotation notes
  }
  
  // C. Build defensive matchup insights
  const defensiveNotes = tracking.defensiveMatchups?.map((m: any) => 
    `vs ${m.opponent}: closeout ${m.closeoutQuality}/10, help ${m.helpTiming}`
  ).join('; ');
  
  // D. Build court zone distribution notes
  const zoneDistribution = Object.entries(tracking.courtZones || {})
    .map(([zone, count]) => `${zone}: ${count}`)
    .join(', ');
  
  // Upsert profile with enhanced data
  await supabase.from('player_behavior_profiles').upsert({
    player_name: player.player_name,
    team: player.team_name,
    // Standard fields
    fatigue_tendency: tracking.fatigueIndicators?.join(', ') || null,
    body_language_notes: `[${date}] Zones: ${zoneDistribution}. Defense: ${defensiveNotes}`,
    film_sample_count: existingProfile.film_sample_count + 1,
    // Enhanced fields
    scoring_zone_preferences: mergeZonePreferences(
      existingProfile?.scoring_zone_preferences, 
      zonePreferences
    ),
    // ... other fields
  }, { onConflict: 'player_name' });
}
```

### 3. New Database Fields (Optional Future Enhancement)

The current schema already has JSONB fields that can store this data:
- `scoring_zone_preferences` → Shot chart zone data
- `body_language_notes` → Defensive matchup observations
- `avg_first_rest_time` / `avg_second_stint_start` → Rotation patterns

No schema changes required - we'll use existing JSONB fields more effectively.

### 4. Update Analysis Results Display

Show the enhanced tracking data in the success state:

```tsx
{/* Enhanced Tracking Results */}
{profile.courtZones && (
  <div className="text-xs text-muted-foreground">
    <span className="text-blue-400">Court Zones:</span> {
      Object.entries(profile.courtZones)
        .map(([z, c]) => `${z}: ${c}`)
        .join(' | ')
    }
  </div>
)}

{profile.shotAttempts?.length > 0 && (
  <div className="text-xs text-muted-foreground">
    <span className="text-green-400">Shots:</span> {
      profile.shotAttempts.map(s => `${s.zone} ${s.result}`).join(', ')
    }
  </div>
)}

{profile.defensiveMatchups?.length > 0 && (
  <div className="text-xs text-muted-foreground">
    <span className="text-orange-400">Defense:</span> {
      profile.defensiveMatchups.map(m => `vs ${m.opponent}`).join(', ')
    }
  </div>
)}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/analyze-game-footage/index.ts` | Add enhanced tracking prompt for selected players, new JSON response structure |
| `src/components/scout/FilmProfileUpload.tsx` | Pass selected player names to edge function, parse tracking response, update profiles with zone/rotation/matchup data |

---

## AI Prompt Changes (analyze-game-footage)

**Before:**
```
Analyze these frames for fatigue, body language, shot mechanics...
```

**After:**
```
SELECTED PLAYERS TO TRACK: [Jalen Brunson, Cade Cunningham]

For each selected player, provide DETAILED TRACKING:

1. JERSEY & COURT POSITION
   - Confirm jersey number
   - Track court zones: restricted_area, paint, mid_range, corner, above_break_3
   - Note frames where player appears

2. SHOT ATTEMPTS
   - Zone location (5-zone model matching player_zone_stats)
   - Result: made/missed/blocked
   - Shot type: catch_shoot, pull_up, post_up, transition

3. ROTATION PATTERNS
   - Visible stint changes
   - Bench appearances
   - Fatigue level when returning to court

4. DEFENSIVE ASSIGNMENTS
   - Who is the player guarding
   - Closeout quality (1-10)
   - Help rotation timing

Return structured JSON with playerTracking array...
```

---

## Integration with Sweet Spots

After these enhancements, the `category-props-analyzer` can leverage:

| Profile Field | Sweet Spots Usage |
|---------------|-------------------|
| `scoring_zone_preferences` | Boost 3PT props if player shows high corner/above-break frequency |
| Defensive matchup notes | Adjust projections based on defensive difficulty |
| Rotation signals | Factor into minutes uncertainty |

The existing integration (Phase 3) already applies adjustments based on `scoring_zone_preferences` and other profile fields.

---

## Expected Outcome

After implementation:
- Users select 1-5 players before analyzing video
- AI tracks each player's jersey, position, shots, rotations, and defensive matchups
- Profile updates include structured shot chart zones and matchup data
- Sweet Spots uses this data to refine projections (e.g., "Player X shoots 40% from corner 3 based on film analysis")
- Results display shows breakdown of what was tracked per player

