

## Accuracy Fix: Block Failing Categories + Add Missing Prop Markets

### Problem
1. **30% hit rate** is driven by game-level picks (OVER_TOTAL at 10%, ML_FAVORITE at 20%, BIG_ASSIST_OVER at 10%) and loose thresholds
2. **Missing prop markets**: The odds scraper only pulls 6 NBA markets: `player_points`, `player_rebounds`, `player_assists`, `player_threes`, `player_blocks`, `player_steals`. It does NOT pull turnovers, combos (PRA, PR, PA, RA), steals+blocks, or double-doubles -- all of which are available on The Odds API and already mapped in other functions like `fetch-current-odds`

### Changes

#### 1. Expand NBA prop markets in the odds scraper
**File:** `supabase/functions/whale-odds-scraper/index.ts`

Add two more batches to the NBA market list:
```
'basketball_nba': [
  ['player_points', 'player_rebounds', 'player_assists'],
  ['player_threes', 'player_blocks', 'player_steals'],
  ['player_turnovers', 'player_double_double'],                          // NEW
  ['player_points_rebounds_assists', 'player_points_rebounds',            // NEW
   'player_points_assists', 'player_rebounds_assists'],
],
```
This gives the generation engine access to turnovers, double-doubles, and all combo markets (PRA, P+R, P+A, R+A). More diverse props = less concentration on the same 4 prop types.

#### 2. Block catastrophic categories in generation
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Add a hardcoded `BLOCKED_CATEGORIES` set near the top:
```
const BLOCKED_CATEGORIES = new Set([
  'OVER_TOTAL',      // 10.2% hit rate
  'UNDER_TOTAL',     // 18.2% hit rate  
  'ML_FAVORITE',     // 20% hit rate (NCAAB already blocked, now block all)
  'BIG_ASSIST_OVER', // 10.3% hit rate
]);
```
Check this set in `canUsePickGlobally` -- if a pick's category is in the blocked set, skip it.

#### 3. Cap SHARP_SPREAD to max 1 per parlay
In the parlay building loop (around line 4219), add a spread-specific cap:
```
if (pickBetType === 'spread') {
  const currentSpreads = legs.filter(l => l.bet_type === 'spread').length;
  if (currentSpreads >= 1) continue;
}
```

#### 4. Tighten quality thresholds
- Raise `MIN_PROJECTION_BUFFER` from 0.3 to 1.0 for player props
- Add `hit_rate_score >= 70` gate in `canUsePickGlobally`
- Lower per-pick reuse from 3 to 2 (reduce blast radius of bad picks)

#### 5. Keep existing anti-stacking logic
The anti-correlation blocking (line 4212-4217) and same-side-total capping (line 4219-4225) stay as-is -- these are already doing the right thing to prevent contradictory legs in the same parlay.

### Expected Impact
- Removing ~244 game-level legs (10-25% hit rate) from the pool
- Adding turnovers, combos, and double-doubles diversifies the prop mix
- Tighter thresholds push remaining picks toward 50%+ individual hit rates
- Lower reuse limits contain blast radius when a pick does miss

### Implementation Sequence
1. Update `whale-odds-scraper` with new NBA market batches and deploy
2. Add `BLOCKED_CATEGORIES` set and filter in generation engine
3. Add spread cap (max 1 per parlay)
4. Raise projection buffer, hit rate gate, and lower reuse limit
5. Deploy generation engine and run test generation

