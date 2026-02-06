# Player Behavior Profile → Sweet Spots Integration

## Status: ✅ IMPLEMENTED (February 2026)

The Player Behavior Profile system is now fully integrated into the Sweet Spots prediction engine.

---

## What Was Implemented

### 1. Edge Function: `category-props-analyzer` (v8.0)

Added profile-based adjustments to `calculateTrueProjection()`:

| Profile Factor | Condition | Adjustment | Applied To |
|----------------|-----------|------------|------------|
| 3PT Peak Quarter | peakQ.pct > 30% | +0.4 projection | threes props |
| Best Matchup (profile) | opponent in best_matchups | +0.5 projection | all props |
| Worst Matchup (profile) | opponent in worst_matchups | -0.5 projection | all props |
| Fatigue Tendency | film shows fatigue | -0.3 projection | all props |
| Film Verified | film_sample_count >= 3 | +FILM flag | all props |
| Blowout Risk | blowout_minutes_reduction > 5 | +BLOWOUT_RISK flag | all props |

New function: `loadPlayerProfiles()` loads profiles from `player_behavior_profiles` table.

### 2. Hook: `useDeepSweetSpots` (v8.0)

Added profile data fetching and score adjustments:

| Profile Factor | Condition | Score Boost |
|----------------|-----------|-------------|
| Film Confidence | film_sample_count >= 3 | +5 points |
| High Profile Confidence | profile_confidence >= 70 | +3 points |
| Peak Quarter (3PT) | peakQ.pct > 30% | +2 points |
| Best Matchup | opponent in best_matchups | +2 points |
| Worst Matchup | opponent in worst_matchups | -2 points |

New `ProfileData` interface attached to each `DeepSweetSpot`.

### 3. Types: `src/types/sweetSpot.ts`

Added new interface:
```typescript
export interface ProfileData {
  peakQuarters: { q1: number; q2: number; q3: number; q4: number } | null;
  hasFatigueTendency: boolean;
  filmSamples: number;
  profileConfidence: number;
  matchupAdvantage: 'favorable' | 'unfavorable' | null;
  profileFlags: string[];
}
```

Added `profileData?: ProfileData` to `DeepSweetSpot` interface.

### 4. UI: `SweetSpotCard.tsx`

Added profile insight badges:
- 🎬 **Film badges** - Shows "X film" when player has film samples
- ✨ **Peak Q badges** - Shows "Peak Q4" for 3PT props with shooting peaks
- 🎯 **Matchup badges** - Shows "Matchup+" or "Matchup-" from profile history
- ⚠️ **Fatigue badges** - Shows "Fatigue" warning for players with fatigue tendency
- ✅ **Verified badge** - Shows when profile confidence >= 70%

---

## Data Flow

```text
YouTube/Film Upload → update-player-profile-from-film → player_behavior_profiles
                                                                    ↓
Game Logs + Zone Stats → build-player-profile ─────────────────────→│
                                                                    ↓
                                                     ┌──────────────────────────┐
                                                     │   category-props-        │
                                                     │   analyzer (v8.0)        │
                                                     │   loads profiles,        │
                                                     │   applies adjustments    │
                                                     └──────────────────────────┘
                                                                    ↓
                                                     ┌──────────────────────────┐
                                                     │   useDeepSweetSpots      │
                                                     │   (v8.0)                 │
                                                     │   fetches profiles,      │
                                                     │   applies score boosts   │
                                                     └──────────────────────────┘
                                                                    ↓
                                                     ┌──────────────────────────┐
                                                     │   SweetSpotCard          │
                                                     │   displays badges        │
                                                     └──────────────────────────┘
```

---

## Testing

To verify the integration:
1. Navigate to `/sweet-spots`
2. Look for players with profile badges (Film, Peak Q, Matchup+/-, Fatigue, Verified)
3. These players should have boosted scores if they have positive profile factors
4. Check console logs for `[Projection] v8.0 Profile found:` messages

---

## Next Steps (Optional)

- [ ] Add profile insights to parlay builder leg selection
- [ ] Create admin dashboard to review profile quality
- [ ] Add manual profile override capability for scouts
- [ ] Track profile-based pick accuracy vs non-profile picks
