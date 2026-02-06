
# Integrating Player Behavior Profiles into Sweet Spots Logic

## Overview

The Player Behavior Profile system (Phases 1 & 2) is now creating rich player data from historical stats and film analysis, but this data is **not yet being used** in the Sweet Spots prediction engine. This plan bridges that gap.

---

## Current State

| Component | Status | Integration with Sweet Spots |
|-----------|--------|------------------------------|
| `player_behavior_profiles` table | Created | Not queried by Sweet Spots |
| `build-player-profile` edge function | Working | Runs independently |
| `scout-agent-loop` film updates | Working | Updates profiles, but not used in predictions |
| `FilmProfileUpload` component | Working | Updates profiles via direct film analysis |
| `category-props-analyzer` | Working | Does NOT load player profiles |
| `useDeepSweetSpots` hook | Working | Does NOT load player profiles |

---

## What Needs to Be Connected

### 1. Category Props Analyzer Integration

The `category-props-analyzer` edge function calculates `calculateTrueProjection()` for each player. We need to add profile-based adjustments:

```text
CURRENT FLOW:
  L10 Median + Matchup H2H + Pace Factor → Projected Value

NEW FLOW (with profiles):
  L10 Median + Matchup H2H + Pace Factor + PROFILE ADJUSTMENTS → Projected Value

PROFILE ADJUSTMENTS:
  • 3PT Peak Quarter Match: +0.3 to +0.5 (if prop aligns with peak quarter)
  • Best Matchup History: +0.5 (from profile.best_matchups)
  • Worst Matchup History: -0.5 (from profile.worst_matchups)
  • Fatigue Tendency: -0.3 (if film shows fatigue patterns)
  • Blowout Minutes Reduction: Flag warning if blowout expected
  • Film Confidence Boost: +5% confidence if film_sample_count >= 3
```

### 2. useDeepSweetSpots Hook Integration

The frontend hook that calculates `DeepSweetSpot` objects needs to:
1. Load player profiles for all players with today's props
2. Apply profile-based score adjustments
3. Display profile insights on cards

### 3. Sweet Spot Card Profile Display

Add a compact profile indicator to `SweetSpotCard.tsx`:
- Peak quarter badge (e.g., "Peak Q4" for 3PT props)
- Matchup advantage/disadvantage indicator
- Film confidence badge (if film samples exist)

---

## Implementation Files

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/category-props-analyzer/index.ts` | Load profiles, apply adjustments to `calculateTrueProjection()` |
| `src/hooks/useDeepSweetSpots.ts` | Fetch profiles, apply score adjustments |
| `src/components/sweetspots/SweetSpotCard.tsx` | Add profile insights section |
| `src/types/sweetSpot.ts` | Add profile data to `DeepSweetSpot` interface |

---

## Technical Details

### A. Category Props Analyzer Changes

**1. Add profile loading function:**
```typescript
let playerProfileCache: Map<string, PlayerProfile> = new Map();

async function loadPlayerProfiles(supabase: any): Promise<void> {
  const { data } = await supabase
    .from('player_behavior_profiles')
    .select('*')
    .gte('games_analyzed', 5); // Only profiles with enough data
  
  playerProfileCache.clear();
  for (const p of (data || [])) {
    playerProfileCache.set(p.player_name?.toLowerCase().trim(), p);
  }
}
```

**2. Modify `calculateTrueProjection()` to apply profile adjustments:**
```typescript
// After pace adjustment, add profile adjustments
let profileAdj = 0;
const profile = playerProfileCache.get(playerName.toLowerCase().trim());

if (profile) {
  // A. 3PT Peak Quarter boost (for threes props)
  if (propType === 'threes' && profile.three_pt_peak_quarters) {
    const peakQ = Object.entries(profile.three_pt_peak_quarters)
      .reduce((max, [q, pct]) => pct > max.pct ? {q, pct} : max, {q: 'q1', pct: 0});
    if (peakQ.pct > 30) {
      profileAdj += 0.4; // Player has a distinct peak quarter
    }
  }
  
  // B. Best/Worst matchup from profile
  const oppNorm = normalizeOpponentName(opponent);
  const bestMatch = profile.best_matchups?.find(m => m.opponent.includes(oppNorm));
  const worstMatch = profile.worst_matchups?.find(m => m.opponent.includes(oppNorm));
  
  if (bestMatch) profileAdj += 0.5;
  if (worstMatch) profileAdj -= 0.5;
  
  // C. Fatigue tendency (from film)
  if (profile.fatigue_tendency?.toLowerCase().includes('fatigue')) {
    profileAdj -= 0.3;
  }
  
  // D. Blowout minutes reduction warning
  if (profile.blowout_minutes_reduction && profile.blowout_minutes_reduction > 5) {
    // Add risk flag instead of penalizing projection
    // projectionSource += '+BLOWOUT_RISK';
  }
}

const projectedValue = l10Median + matchupAdj + paceAdj + profileAdj;
```

**3. Apply confidence boost for film-analyzed players:**
```typescript
// In confidence calculation
if (profile?.film_sample_count >= 3) {
  confidenceBonus += 0.05; // +5% confidence for film-verified players
}
```

### B. useDeepSweetSpots Changes

**1. Fetch profiles alongside other data:**
```typescript
// In queryFn, add profile fetch
const { data: profilesData } = await supabase
  .from('player_behavior_profiles')
  .select('player_name, three_pt_peak_quarters, best_matchups, worst_matchups, fatigue_tendency, film_sample_count, profile_confidence')
  .in('player_name', playerNames);

const profilesByPlayer = new Map();
for (const p of profilesData || []) {
  profilesByPlayer.set(p.player_name, p);
}
```

**2. Add profile data to DeepSweetSpot:**
```typescript
// When building each spot
const profile = profilesByPlayer.get(prop.player_name);

// Apply profile boost to sweetSpotScore
let profileBoost = 0;
if (profile) {
  if (profile.film_sample_count >= 3) profileBoost += 5;
  if (profile.profile_confidence >= 70) profileBoost += 3;
}

const spot: DeepSweetSpot = {
  // ... existing fields
  sweetSpotScore: calculateSweetSpotScore(...) + profileBoost,
  profileData: profile ? {
    peakQuarters: profile.three_pt_peak_quarters,
    hasFatigueTendency: profile.fatigue_tendency?.includes('fatigue'),
    filmSamples: profile.film_sample_count || 0,
    profileConfidence: profile.profile_confidence || 0,
  } : undefined,
};
```

### C. Type Updates

**Add to `DeepSweetSpot` interface:**
```typescript
export interface DeepSweetSpot {
  // ... existing fields
  
  // Profile-based insights (optional)
  profileData?: {
    peakQuarters: { q1: number; q2: number; q3: number; q4: number } | null;
    hasFatigueTendency: boolean;
    filmSamples: number;
    profileConfidence: number;
    matchupAdvantage?: 'favorable' | 'unfavorable' | null;
  };
}
```

### D. Sweet Spot Card UI

**Add profile badges:**
```tsx
{/* Profile Insights Row */}
{spot.profileData && (spot.profileData.filmSamples > 0 || spot.profileData.peakQuarters) && (
  <div className="flex items-center gap-2 text-xs">
    {spot.profileData.filmSamples > 0 && (
      <Badge variant="outline" className="text-purple-400 border-purple-500/30">
        <Film className="w-3 h-3 mr-1" />
        {spot.profileData.filmSamples} film
      </Badge>
    )}
    
    {spot.propType === 'threes' && spot.profileData.peakQuarters && (
      <Badge variant="outline" className="text-blue-400 border-blue-500/30">
        Peak Q{getPeakQuarter(spot.profileData.peakQuarters)}
      </Badge>
    )}
    
    {spot.profileData.hasFatigueTendency && (
      <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">
        <AlertTriangle className="w-3 h-3 mr-1" />
        Fatigue risk
      </Badge>
    )}
  </div>
)}
```

---

## Data Flow After Integration

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                     COMPLETE PROFILE → SWEET SPOTS FLOW                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌─────────────────────────┐                    │
│  │ YouTube/Film     │───→│ update-player-profile   │                    │
│  │ Upload           │    │ -from-film (vision AI)  │                    │
│  └──────────────────┘    └───────────┬─────────────┘                    │
│                                      │                                   │
│                                      ▼                                   │
│  ┌──────────────────┐         ┌─────────────────────┐                   │
│  │ Game Logs +      │────────→│ player_behavior_    │                   │
│  │ Zone Stats       │         │ profiles (DB)       │                   │
│  └──────────────────┘         └───────────┬─────────┘                   │
│                                           │                              │
│            ┌──────────────────────────────┼──────────────────────────┐  │
│            │                              ▼                          │  │
│            │                   ┌──────────────────────┐              │  │
│            │                   │ category-props-      │              │  │
│            │                   │ analyzer             │              │  │
│            │                   │ (loads profiles)     │              │  │
│            │                   └──────────┬───────────┘              │  │
│            │                              │                          │  │
│            │                              ▼                          │  │
│            │                   ┌──────────────────────┐              │  │
│            │                   │ category_sweet_spots │              │  │
│            │                   │ (with profile adj)   │              │  │
│            │                   └──────────┬───────────┘              │  │
│            │                              │                          │  │
│            ▼                              ▼                          │  │
│  ┌──────────────────┐         ┌──────────────────────┐              │  │
│  │ useDeepSweetSpots│────────→│ SweetSpotCard.tsx    │              │  │
│  │ (loads profiles) │         │ (displays badges)    │              │  │
│  └──────────────────┘         └──────────────────────┘              │  │
│                                                                      │  │
│            ◄─────────── PROFILE DATA ENRICHES ───────────►          │  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Profile Weight Matrix

| Profile Factor | Condition | Adjustment | Applied To |
|----------------|-----------|------------|------------|
| 3PT Peak Quarter | peakQ.pct > 30% | +0.4 projection | threes props |
| Best Matchup (profile) | opponent in best_matchups | +0.5 projection | all props |
| Worst Matchup (profile) | opponent in worst_matchups | -0.5 projection | all props |
| Fatigue Tendency | film shows fatigue | -0.3 projection | all props |
| Film Confidence | film_sample_count >= 3 | +5% confidence | all props |
| High Profile Confidence | profile_confidence >= 70 | +3 score points | all props |
| Blowout Risk | blowout_minutes_reduction > 5 | Add risk flag | minutes-sensitive |

---

## Implementation Priority

1. **Edge Function**: Modify `category-props-analyzer` to load and apply profiles (highest impact)
2. **Hook**: Update `useDeepSweetSpots` to fetch and attach profile data
3. **Types**: Add `profileData` to `DeepSweetSpot` interface
4. **UI**: Add profile badges to `SweetSpotCard`
5. **Testing**: Verify profile adjustments are reflected in scores

---

## Expected Outcome

After implementation:
- Film-analyzed players get confidence boosts in Sweet Spots
- Peak 3PT quarters inform threes prop recommendations
- Profile-based matchup history supplements H2H data
- Fatigue tendency from film reduces projections appropriately
- UI shows profile indicators so users understand why a pick is recommended
- The system "learns" player behaviors that don't appear in box scores
