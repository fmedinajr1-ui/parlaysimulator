# Player-Specific Film Learning System

## Status: Phase 2 Complete ✓

### Implemented
- [x] `player_behavior_profiles` database table
- [x] `build-player-profile` edge function
- [x] `usePlayerProfile` hook
- [x] `PlayerProfileCard` component
- [x] `scout-agent-loop` updates profiles with film insights
- [x] Accumulated fatigue_tendency and body_language_notes

### Next Steps
- [ ] Integrate profiles into `category-props-analyzer`
- [ ] Add profile display to Sweet Spots cards
- [ ] Set up nightly cron job for profile building

---

## Overview

This system learns individual player patterns by combining **historical data APIs** with optional **film analysis**:
- When players shoot 3s most (by quarter)
- Coach substitution patterns
- Matchup-specific performance
- Film-derived insights (fatigue, effort, body language)

---

## Data Sources

### Film Sources (No Public API)
| Source | Access | Notes |
|--------|--------|-------|
| **Synergy/Second Spectrum** | Team-only ($50K+/year) | Not available |
| **Uploaded clips** | Free (manual) | AI extracts signals |

### Data APIs (Already Integrated)
| API | Data Provided |
|-----|---------------|
| **ESPN PBP** | Live stats, substitutions, quarter-by-quarter |
| **BallDontLie** | Game logs, season averages |
| **Zone Stats** | Player shot distribution by court zone |

---

## Database Schema

```sql
player_behavior_profiles:
- player_name, team
- three_pt_peak_quarters (JSONB: q1-q4 percentages)
- scoring_zone_preferences (JSONB: zone frequencies)
- best_matchups / worst_matchups (JSONB arrays)
- avg_minutes_per_quarter (JSONB)
- blowout_minutes_reduction (NUMERIC)
- fatigue_tendency, body_language_notes (TEXT - from film)
- film_sample_count, games_analyzed
- profile_confidence (0-100)
```

---

## Edge Function: `build-player-profile`

```typescript
// Build single player profile
POST /functions/v1/build-player-profile
{ "playerName": "Anthony Edwards", "team": "MIN" }

// Build all profiles (nightly)
POST /functions/v1/build-player-profile
{ "buildAll": true }
```

**Aggregates:**
1. Quarter-by-quarter 3PT distribution
2. Zone shooting preferences from `player_zone_stats`
3. Best/worst matchup analysis from game logs
4. Rotation patterns (minutes, rest times)
5. Blowout minutes reduction

---

## How Profiles Enhance Predictions

**Before Profile:**
```
Line: Edwards O/U 28.5 PTS
L10 median: 26.2
Zone matchup: +5
→ Predict: 27.5 (slight UNDER)
```

**With Profile:**
```
Line: Edwards O/U 28.5 PTS vs Lakers
L10 median: 26.2
Zone matchup: +5
Profile insights:
  - Q3/Q4 peak 3s (60% of 3PM)
  - vs LAL: 31.2 avg (+5 vs normal)
  - Film: Strong effort in recent samples
→ Predict: 29.8 (OVER lean)
```

---

## Film Enhancement (Phase 2)

When film is uploaded for a player, `scout-agent-loop` accumulates:
- Fatigue signals → `fatigue_tendency`
- Effort/speed signals → `body_language_notes`
- Increments `film_sample_count`

These insights persist across sessions and improve over time.

---

## Files

| File | Purpose |
|------|---------|
| `supabase/functions/build-player-profile/index.ts` | Edge function |
| `src/hooks/usePlayerProfile.ts` | Data fetching hooks |
| `src/components/scout/PlayerProfileCard.tsx` | UI display |

---

## Usage

```tsx
import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import { PlayerProfileCard } from "@/components/scout/PlayerProfileCard";

function MyComponent() {
  const { data: profile } = usePlayerProfile("Anthony Edwards");
  
  if (profile) {
    return <PlayerProfileCard profile={profile} />;
  }
}
```

---

## Value: Film vs Data Only

| Insight | Data APIs | Film |
|---------|-----------|------|
| 3PT by quarter | ✓ (quarter totals) | Visual confirmation |
| Substitutions | ✓ (PBP events) | Bench body cues |
| Matchups | ✓ (opponent stats) | Defensive effort |
| Fatigue | ✗ | ✓ Hands on knees, slow recovery |
| Body language | ✗ | ✓ Frustration, energy |
| Shot mechanics | ✗ | ✓ Form breakdown |

**Data = 70%** of insights. **Film = 30%** (behavioral cues not in box scores).
