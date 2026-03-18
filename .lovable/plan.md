

# Smart Leg Replacement + Pick Pool Visibility + Deterministic Side Selection

## Problem Summary

Over the last 3 days, **33 parlays were voided for exposure cap** and **27 for diversity rebalance** — that's 60 parlays thrown away instead of being repaired. Meanwhile, picks that pass all quality gates but don't make it into parlays are invisible. And the bot picks over/under based on simple L10 median position instead of using accumulated outcome history.

## Three Changes

### 1. Replace-Not-Void: Swap Exposed Legs Instead of Voiding Parlays
**Files**: `bot-quality-regen-loop/index.ts`, `bot-daily-diversity-rebalance/index.ts`

When a parlay hits the exposure cap (player appears in too many parlays), instead of voiding the entire parlay:

1. Identify the exposed player's leg in the lower-probability parlay
2. Query `category_sweet_spots` for active picks NOT already in any pending parlay
3. Find a replacement leg that:
   - Is from a different player
   - Has a different game (if safe mode)
   - Passes composite/projection buffer gates
   - Has the highest confidence_score among candidates
4. Swap the leg, recalculate `combined_probability` and `expected_odds`
5. Only void if zero replacement candidates exist

Same logic applies to diversity rebalance — instead of voiding parlays that exceed per-category caps, swap the excess category leg with a pick from an underrepresented category.

### 2. Store & Surface the Pick Pool ("Bench Picks")
**New table**: `bot_daily_pick_pool`

```sql
CREATE TABLE bot_daily_pick_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date date NOT NULL,
  player_name text NOT NULL,
  prop_type text,
  recommended_side text,
  recommended_line numeric,
  l10_hit_rate numeric,
  l10_avg numeric,
  l3_avg numeric,
  confidence_score numeric,
  composite_score numeric,
  projected_value numeric,
  rejection_reason text,       -- 'exposure_cap', 'buffer_gate', 'score_gate', 'not_selected', etc.
  was_used_in_parlay boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```

**File**: `bot-generate-daily-parlays/index.ts` — At the end of generation, dump ALL qualified picks (the full pool after quality gates) into this table, marking `was_used_in_parlay = true/false` and `rejection_reason` for filtered ones.

**File**: New Telegram digest — After generation, send a "Bench Picks" summary (top 10 unused picks by confidence) so you can see what's available but wasn't selected.

**File**: `src/components/bot/BotBenchPicks.tsx` — New UI panel showing today's bench picks with filters.

### 3. Deterministic Over/Under Selection Using Historical Outcomes
**File**: `category-props-analyzer/index.ts`

The bot already has `autoFlipUnderperformingCategories()` (v10.0) that checks category-level over/under hit rates. Extend this to **per-player per-prop** level:

1. Query `category_sweet_spots` settled outcomes for each player+prop_type combination
2. If a player has 10+ graded outcomes:
   - Calculate `over_hit_rate` and `under_hit_rate` separately
   - If `over_hit_rate < 45%` and `under_hit_rate > 55%`, force side to `under` (and vice versa)
   - If both sides are between 45-55%, use the standard projection-based side selection
3. Store the historical side performance in the pick pool entry so it's visible
4. Log deterministic flips to Telegram: "Flipped Jaylen Brown points to UNDER (historical: over 38%, under 62%, 24 samples)"

This uses the existing `category_sweet_spots` outcome data (hit/miss/push) that's already being tracked and settled.

## Files to Change

| File | Change |
|------|--------|
| `bot-quality-regen-loop/index.ts` | Replace exposure-cap void with leg-swap from available pool |
| `bot-daily-diversity-rebalance/index.ts` | Replace diversity-cap void with category-swap |
| `bot-generate-daily-parlays/index.ts` | Log full pick pool to `bot_daily_pick_pool` table |
| `category-props-analyzer/index.ts` | Per-player historical side selection (deterministic flips) |
| New migration | Create `bot_daily_pick_pool` table |
| `bot-send-telegram/index.ts` | Add `bench_picks_digest` message type |
| `src/components/bot/BotBenchPicks.tsx` | New UI panel for bench picks |

