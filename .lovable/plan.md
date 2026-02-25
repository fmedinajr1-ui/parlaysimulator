

## Restore Feb 23 Volume: Add Force-Fresh to Pipeline + Relax Filters

### The Problem

Today's generation produced only **8 parlays** vs **97 on Feb 23** (our best day at +$12,353).

### Root Cause Analysis

| Factor | Feb 23 (97 parlays) | Feb 25 (8 parlays) |
|--------|--------------------|--------------------|
| `bot-force-fresh-parlays` | Ran (produced 24 parlays) | NOT in pipeline |
| `bot-generate-daily-parlays` | 73 parlays | 6 parlays |
| Prop pool | 500 sweet spots + props | 500 sweet spots + 2,636 props (bigger pool!) |
| Blocked categories | Fewer blocks | 7+ categories auto-blocked |

The pool is actually LARGER today than Feb 23, but two things are killing volume:

1. **`bot-force-fresh-parlays` is missing from the pipeline** -- It contributed 24 `force_mispriced_conviction` parlays on Feb 23 but is only callable via Telegram `/forcegen`. The orchestrator never runs it.

2. **Over-aggressive filters** -- Categories like `HIGH_ASSIST` (33% hit rate), `LOW_LINE_REBOUNDER` (39%), `VOLUME_SCORER` (46.9%) are all blocked. Combined with static blocks on `steals` and `blocks` prop types, most candidates get filtered out.

### Plan

#### Step 1: Add `bot-force-fresh-parlays` to the orchestrator pipeline

**File:** `supabase/functions/data-pipeline-orchestrator/index.ts`

In Phase 3 (Generation), add `bot-force-fresh-parlays` BEFORE `bot-review-and-optimize`:

```text
// Run force-fresh mispriced conviction parlays (source of 24/97 on Feb 23)
await runFunction('bot-force-fresh-parlays', {});
```

This restores the `force_mispriced_conviction` strategy that produced 24 parlays on our best day.

#### Step 2: Relax blocked categories to match Feb 23 config

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Remove `VOLUME_SCORER` (46.9%) and `ELITE_REB_OVER` (41.7%) from `BLOCKED_CATEGORIES`. These hit rates are viable for exploration-tier parlays where we need volume.

Keep truly catastrophic blocks: `OVER_TOTAL` (10.2%), `UNDER_TOTAL` (18.2%), `ML_FAVORITE` (20%), `BIG_ASSIST_OVER` (10.3%).

#### Step 3: Relax auto-block threshold from 40% to 30%

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

In `buildPropPool`, change the auto-block threshold from `current_hit_rate < 40` to `current_hit_rate < 30`. This unblocks `HIGH_ASSIST` (33%) and `LOW_LINE_REBOUNDER` (39%) which are viable for exploration volume.

#### Step 4: Remove static blocks on steals and blocks prop types

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Remove `steals` and `blocks` from `STATIC_BLOCKED_PROP_TYPES`. These are valid peripheral props that add diversity. The Feb 23 winning slate included them.

#### Step 5: Add regen trigger to pipeline Phase 3B

**File:** `supabase/functions/data-pipeline-orchestrator/index.ts`

In the mid-day regen check (Phase 3B), also call `bot-force-fresh-parlays` when parlay count is below 10. This ensures we always have force-fresh mispriced parlays as backup volume.

### Expected Impact

- Restores `force_mispriced_conviction` strategy (+24 parlays/day)
- Unblocks 4 categories and 2 prop types from over-filtering
- Target: 60-100 parlays/day (matching Feb 23 volume)
- Maintains quality gates for execution tier (strict filters preserved)

### Files Modified
- `supabase/functions/data-pipeline-orchestrator/index.ts` -- Add force-fresh-parlays to generation pipeline
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- Relax blocked categories, lower auto-block threshold, unblock steals/blocks props

