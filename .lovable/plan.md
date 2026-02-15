

# Fix: Improve Leg Accuracy by Blocking Weak Categories

## The Problem

Looking at your settled parlay data, several leg types have been consistently losing:

- **NCAAB OVER totals**: Only **31% hit rate** (4/13). Games like Texas A&M/Vanderbilt O165.5 (actual: 151), UCLA/Michigan O155.5 (actual: 142), Northwestern/Nebraska O145.5 (actual: 117) -- all missed badly.
- **Home moneylines**: Only **25% hit rate** (6/24)
- **Home spreads**: Only **43% hit rate** (9/21)
- Meanwhile, player prop UNDERs hit at **74%** and player prop OVERs hit at **60%** -- these are your best categories but are underused.

Overall parlay win rate is **29%**, mostly dragged down by these weak team-based legs.

## What We'll Fix

### 1. Block NCAAB OVER totals from generation

The data is clear -- NCAAB game totals heavily favor the UNDER. The bot should stop generating OVER total legs for NCAAB games until performance improves.

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Add a hard block: if `sport === 'basketball_ncaab'` and `bet_type === 'total'` and `side === 'over'`, reject the leg
- Allow NCAAB UNDER totals to continue (they perform well at ~39% in the category weights)

### 2. Reduce home moneyline exposure

Home moneylines are hitting at 25%. The generator should either:
- Block home moneyline picks entirely, OR
- Require a minimum sharp score of 70+ for home ML picks (currently accepting 50+)

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Raise the minimum composite score threshold for `bet_type === 'moneyline'` and `side === 'home'` from ~50 to 75

### 3. Increase minimum composite score for team picks

Many team legs have low composite scores (50-55), which indicates weak confidence. Raising the floor improves quality.

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Change team pick minimum composite score from 50 to 65 for all team-based legs
- This filters out the weakest team picks while still allowing strong signals through

### 4. Prioritize player prop UNDERs

Player prop UNDERs are the strongest category at 74% hit rate. The generation weights should be boosted so more parlays include these legs.

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Increase the weight multiplier for UNDER-side player props during candidate ranking
- Target at least 1 UNDER leg per parlay when available

### 5. Auto-calibrate category blocks from actual results

Add a check during generation that reads the `bot_category_weights` table and automatically blocks any category + side combination with fewer than 40% hit rate AND 10+ settled picks.

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Query `bot_category_weights` at generation time
- Build a block list of categories where `current_hit_rate < 40` and `total_picks >= 10`
- Skip any candidate leg matching a blocked category

## Technical Details

### Hard block for NCAAB OVER totals (in team pick filtering)
```typescript
// Block NCAAB OVER totals - only 31% hit rate historically
if (pick.sport === 'basketball_ncaab' && pick.betType === 'total' && pick.side === 'over') {
  console.log(`[Bot] Blocked NCAAB OVER total: ${pick.awayTeam} @ ${pick.homeTeam} O${pick.line}`);
  return false;
}
```

### Dynamic category blocking (at generation start)
```typescript
const { data: weakCategories } = await supabaseAdmin
  .from('bot_category_weights')
  .select('category, side, current_hit_rate, total_picks')
  .lt('current_hit_rate', 40)
  .gte('total_picks', 10);

const blockedCombos = new Set(
  (weakCategories || []).map(c => `${c.category}_${c.side}`)
);
```

### Composite score floor raise
```typescript
// For team-based picks, require composite score >= 65
if (pick.type === 'team' && pick.compositeScore < 65) {
  return false;
}
```

## Expected Impact

- Eliminates the biggest source of losses (NCAAB OVER totals)
- Raises quality floor for all team picks
- Self-healing via dynamic category blocking based on real results
- Should improve overall parlay win rate from ~29% toward 40%+

