

## Implementation Plan: `sweet_spot_l3` 5-Leg Strategy

### What It Does
Creates a new parlay strategy that builds **5-leg parlays** from sweet spots, ranking candidates by how well their **last 3 games** clear the betting line (instead of L10 hit rate). This targets players who are hot *right now*.

### Scoring
- **OVER**: `l3_score = l3_avg - line` (higher = more recent production above line)
- **UNDER**: `l3_score = line - l3_avg` (higher = more recent production below line)
- Only picks where L3 avg clears the line in the right direction qualify
- Picks without `l3_avg` data are excluded

### Changes — `supabase/functions/bot-generate-daily-parlays/index.ts`

#### 1. Add 3 Execution Profiles (~line 975)
Insert after the last `sweet_spot_core` profile and before the SWEET SPOT PLUS comment:
```
{ legs: 5, strategy: 'sweet_spot_l3', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'l3_score' }
{ legs: 5, strategy: 'sweet_spot_l3', sports: ['all'], minHitRate: 55, sortBy: 'l3_score' }
{ legs: 5, strategy: 'sweet_spot_l3', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'l3_score' }
```

#### 2. Add to PRIORITY_STRATEGIES (~line 6591)
Add `'sweet_spot_l3'` to the set so it bypasses the 30% diversity cap.

#### 3. Add Strategy Detection (~line 6648)
```typescript
const isSweetSpotL3Profile = profile.strategy === 'sweet_spot_l3';
```

#### 4. Add Candidate Selection Block (~after line 6783, after sweet_spot_core block)
```typescript
} else if (isSweetSpotL3Profile) {
  // Filter: must have l3_avg, l3_avg must clear line on recommended side
  const filtered = pool.sweetSpots.filter(p => {
    if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
    if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
    const l3 = (p as any).l3_avg;
    if (l3 == null) return false;
    const hr = p.l10_hit_rate || p.confidence_score || 0;
    const hrPct = hr <= 1 ? hr * 100 : hr;
    if (hrPct < (profile.minHitRate || 55)) return false;
    const side = (p.recommended_side || 'over').toLowerCase();
    if (side === 'over' && l3 <= p.line) return false;
    if (side === 'under' && l3 >= p.line) return false;
    return true;
  });
  // Score by L3 distance from line
  candidatePicks = filtered.map(p => {
    const l3 = (p as any).l3_avg;
    const side = (p.recommended_side || 'over').toLowerCase();
    const l3Score = side === 'over' ? l3 - p.line : p.line - l3;
    (p as any)._l3Score = l3Score;
    return p;
  }).sort((a, b) => ((b as any)._l3Score || 0) - ((a as any)._l3Score || 0));

  if (candidatePicks.length < profile.legs) {
    console.log(`[Bot] ${tier}/sweet_spot_l3: only ${candidatePicks.length} L3-qualified picks, need ${profile.legs}`);
    continue;
  }
  console.log(`[Bot] ${tier}/sweet_spot_l3: ${candidatePicks.length} candidates sorted by L3 score (top: ${candidatePicks[0]?.player_name} L3=${((candidatePicks[0] as any)?.l3_avg || 0).toFixed(1)})`);
```

#### 5. Deploy and Invoke
Deploy the updated function, then invoke the daily parlay generator to create the L3-scored parlays for today.

