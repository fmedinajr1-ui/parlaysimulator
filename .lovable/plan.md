

# Composite Filter Verification & Fix Plan

## What I Found

### 1. Composite Filter Code EXISTS but is NOT Running
The composite filter code is present in `bot-generate-daily-parlays/index.ts` (lines 11022-11191) with the correct formula and conflict detection. However, **zero `[CompositeFilter]` log lines appear** in the latest run. This means either:
- The function was **not redeployed** after the composite code was added (the deployed version is stale)
- OR the `dedupedParlays` array is empty by the time it reaches the composite section

The logs show parlays *are* being created (10 optimal_combo parlays logged), so the most likely cause is the **function wasn't redeployed**.

### 2. Why All Parlays Keep Getting Voided
Today's parlays break down as:
- 6 voided by `exposure_cap_quality_regen` (quality regen loop voids parlays exceeding player exposure)
- 4 voided by `Voided for L10-fresh rebuild` (the `refresh-l10-and-rebuild` pipeline voids ALL pending parlays before regenerating — this is **by design** but means running the pipeline twice voids the first run's output)
- 3 voided by `diversity_rebalance_cap_2` (the diversity rebalance step caps same-strategy parlays)
- **2 survived as `pending`** (both exploration tier, 3-leg optimal_combo)

So only 2 out of 15 parlays survive. The main culprit is the **quality regen exposure cap** voiding 6 parlays.

### 3. Why Composite Conflict Report Never Arrives on Telegram
The code sends `type: 'composite_conflict_report'` to `bot-send-telegram`, but **`bot-send-telegram` has no handler for this type**. It silently drops the message.

## Plan

### Step 1: Redeploy `bot-generate-daily-parlays`
Force redeploy the function so the composite filter code actually executes. This should produce `[CompositeFilter]` log lines on the next run.

### Step 2: Add `composite_conflict_report` handler to `bot-send-telegram`
**File**: `supabase/functions/bot-send-telegram/index.ts`

Add a case for `type === 'composite_conflict_report'` that formats the conflicts into a readable Telegram message:
```
⚠️ COMPOSITE CONFLICT REPORT (March 16)
━━━━━━━━━━━━━━━━━━━
❌ Paolo Banchero PTS OVER 24.5
   L10: 22.1 | L5: 20.8 | L3: 19.5 | Composite: 20.4
   Parlay #2 (exploration)

3 conflicts found across 15 legs
```

### Step 3: Increase quality regen exposure cap
The `exposure_cap_quality_regen` void reason is killing 6/15 parlays. With the exposure cap already raised to 2 in `bot-force-fresh-parlays`, the quality regen loop likely still has its own cap at 1. Locate and align it to 2.

### Files to Edit
1. `supabase/functions/bot-send-telegram/index.ts` — add `composite_conflict_report` handler
2. `supabase/functions/bot-quality-regen-loop/index.ts` — check/raise exposure cap from 1 to 2
3. Redeploy `bot-generate-daily-parlays` (no code changes, just deploy)

