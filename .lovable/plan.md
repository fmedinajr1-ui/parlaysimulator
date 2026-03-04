

# Fix: Increase Parlay Volume and Quality for Customers

## Problem
The diversity rebalance is voiding 98.6% of generated parlays, leaving only 5 active picks — far too few. The exposure cap (max 1 usage per player-prop combo) is too strict given that high-conviction picks naturally appear across multiple strategies.

## Plan

### 1. Relax exposure cap from 1 to 3 in `bot-daily-diversity-rebalance`
- File: `supabase/functions/bot-daily-diversity-rebalance/index.ts`
- Change `MAX_EXPOSURE` from 1 to 3 — allow a player-prop combo to appear in up to 3 different parlays
- This preserves diversity intent while keeping volume viable

### 2. Raise strategy cap from 30% to 40%
- In the same file, increase `STRATEGY_CAP_PCT` from 0.30 to 0.40
- With only ~20 parlays surviving, a 30% cap = max 6 per strategy, which is too tight

### 3. Ensure `double_confirmed_conviction` is generated
- File: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Verify the strategy profile for `double_confirmed_conviction` (best historical performer at 54.5% win rate) has its boosted count of 13
- If missing from generation, investigate why zero were produced today

### 4. Improve High Roller lottery quality
- File: `supabase/functions/bot-generate-daily-parlays/index.ts` (lottery scanner section)
- Require at least 2 L10-backed anchor legs (currently only 1)
- Block parlays where >60% of legs are team bets with <50% hit rate

### 5. Add the `bot_daily_parlays` source to the frontend hub
- File: `src/hooks/useDailyParlays.ts`
- Add a `useQuery` fetching from `bot_daily_parlays` where `parlay_date = today` and `outcome = 'pending'`
- Parse legs into `UnifiedParlayLeg[]`, map strategy names to display types
- Add `'LOTTERY'` and `'CURATED'` to the type union
- File: `src/components/parlays/UnifiedParlayCard.tsx`
- Add visual treatment for lottery (gold badge) and curated (blue badge) types

### 6. Redeploy all 3 edge functions after changes

## Expected Outcome
- ~15-25 active parlays instead of 3
- Mix of curated (high quality), execution (volume), and lottery (upside)
- `double_confirmed_conviction` strategy represented
- Higher quality lottery tickets with more L10-backed legs
- All parlay sources visible on the homepage

