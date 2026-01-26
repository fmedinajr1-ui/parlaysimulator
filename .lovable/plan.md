
# Reliability Badges + Elite 3-Point Parlay Builder

## Overview
Adding two features:
1. **Reliability tier badges** to the Optimal 6-Leg parlay builder UI to distinguish proven players from new/unproven ones
2. **Elite 3-Point Parlay Builder** that only uses picks with 97%+ (effectively 100%) L10 hit rate on threes

---

## Feature 1: Reliability Tier Badges in Optimal 6-Leg Builder

### Current State
The `SweetSpotDreamTeamParlay.tsx` component displays parlay legs with player names, team badges, injury status, and L10 hit rates, but does NOT show player reliability tiers (elite, reliable, neutral, caution, avoid) from historical performance.

### Implementation

#### 1.1 Extend SweetSpotPick Interface
**File**: `src/hooks/useSweetSpotParlayBuilder.ts`

Add reliability fields to the interface:
```typescript
export interface SweetSpotPick {
  // ... existing fields
  reliabilityTier?: string | null;
  reliabilityHitRate?: number | null;
  reliabilityModifier?: number | null;
}
```

#### 1.2 Fetch Reliability Data in Query
**File**: `src/hooks/useSweetSpotParlayBuilder.ts`

Add query to fetch player reliability scores:
```typescript
const { data: reliabilityScores } = await supabase
  .from('player_reliability_scores')
  .select('player_name, prop_type, reliability_tier, hit_rate, confidence_modifier, should_block');

// Create lookup map
const reliabilityMap = new Map();
(reliabilityScores || []).forEach(r => {
  const key = `${r.player_name?.toLowerCase()}_${r.prop_type?.toLowerCase()}`;
  reliabilityMap.set(key, {
    tier: r.reliability_tier,
    hitRate: r.hit_rate,
    modifier: r.confidence_modifier,
    shouldBlock: r.should_block
  });
});
```

#### 1.3 Attach Reliability to Picks
When building picks, attach reliability data:
```typescript
const reliability = reliabilityMap.get(`${playerKey}_${propType}`);
return {
  ...pick,
  reliabilityTier: reliability?.tier || null,
  reliabilityHitRate: reliability?.hitRate || null,
  reliabilityModifier: reliability?.modifier || null,
};
```

#### 1.4 Add Badge to UI
**File**: `src/components/market/SweetSpotDreamTeamParlay.tsx`

Import and use `PlayerReliabilityBadge`:
```tsx
import { PlayerReliabilityBadge } from "@/components/props/PlayerReliabilityBadge";

// In the leg rendering:
<PlayerReliabilityBadge 
  tier={leg.pick.reliabilityTier}
  hitRate={leg.pick.reliabilityHitRate}
  modifier={leg.pick.reliabilityModifier}
/>
```

#### 1.5 Add "NEW" Badge for Unproven Players
For players without reliability data:
```tsx
{!leg.pick.reliabilityTier && (
  <Badge className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-400 border-blue-500/30">
    NEW
  </Badge>
)}
```

---

## Feature 2: Elite 3-Point Parlay Builder

### Concept
Create a dedicated builder that ONLY uses THREE_POINT_SHOOTER picks with 97%+ L10 hit rate (effectively 100%). Based on your data, there are ~50+ players hitting this threshold today.

### Implementation

#### 2.1 Create New Hook
**File**: `src/hooks/useEliteThreesBuilder.ts`

```typescript
export function useEliteThreesBuilder() {
  const MIN_HIT_RATE = 0.97; // 97%+
  const MAX_LEGS = 4; // Optimal 4-leg for threes
  
  // Query picks with 97%+ L10 hit rate
  const { data, isLoading } = useQuery({
    queryKey: ['elite-threes-parlay'],
    queryFn: async () => {
      const today = getEasternDate();
      
      const { data: picks } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('analysis_date', today)
        .eq('category', 'THREE_POINT_SHOOTER')
        .gte('l10_hit_rate', MIN_HIT_RATE)
        .not('actual_line', 'is', null)
        .order('l10_hit_rate', { ascending: false });
      
      // Filter to active games only (via unified_props check)
      // Cross-reference reliability to block known "avoid" players
      // Apply team diversity (max 1 per team)
      
      return filteredPicks;
    }
  });
  
  const buildEliteThreesParlay = () => {
    // Select top 4 picks with team diversity
    // Add to parlay builder
  };
  
  return { eliteThreesPicks, isLoading, buildEliteThreesParlay };
}
```

#### 2.2 Selection Logic
- **Filter**: Only `THREE_POINT_SHOOTER` category with `l10_hit_rate >= 0.97`
- **Require Active Line**: Must have `actual_line` (game today)
- **Block Avoid Tier**: Cross-reference `player_reliability_scores` to exclude `should_block = true`
- **Team Diversity**: Max 1 player per team
- **Sort by**: L10 hit rate DESC, then confidence DESC

#### 2.3 Create UI Card
**File**: `src/components/market/EliteThreesParlayCard.tsx`

A compact card similar to `SweetSpotDreamTeamParlay`:
- Header: "Elite 3PT Parlay" with purple/violet theme
- Badge: "97%+ L10" indicator
- Stats: Combined hit probability, theoretical parlay odds
- Legs: 4 players with L10%, edge, and line
- Build button: "Build 4-Leg Elite"

#### 2.4 Add to Daily Parlay Hub
**File**: `src/components/market/DailyParlayHub.tsx`

Add the Elite 3PT card alongside Optimal, Sharp, and Heat parlays.

---

## Technical Summary

| Task | File | Change Type |
|------|------|-------------|
| Add reliability fields to SweetSpotPick | useSweetSpotParlayBuilder.ts | Interface update |
| Fetch player_reliability_scores | useSweetSpotParlayBuilder.ts | Query addition |
| Attach reliability to picks | useSweetSpotParlayBuilder.ts | Data mapping |
| Add PlayerReliabilityBadge to UI | SweetSpotDreamTeamParlay.tsx | Component import + render |
| Add "NEW" badge for unproven | SweetSpotDreamTeamParlay.tsx | Conditional render |
| Create useEliteThreesBuilder hook | useEliteThreesBuilder.ts | New file |
| Create EliteThreesParlayCard | EliteThreesParlayCard.tsx | New file |
| Add to DailyParlayHub | DailyParlayHub.tsx | Component integration |

---

## Expected UI Result

### Optimal 6-Leg Parlay
Each leg now shows:
- Player name + team badge
- **Reliability badge**: Elite (gold), Reliable (green), Neutral (gray), Caution (orange), Avoid (red), or **NEW** (blue)
- Prop type, line, edge
- L10 hit rate, H2H, confidence

### Elite 3PT Parlay Card
New card showing:
- 4 legs from players with 100% L10 hit rate on threes
- Purple/violet theme to differentiate
- Combined probability indicator
- "Build Elite 3PT" button
