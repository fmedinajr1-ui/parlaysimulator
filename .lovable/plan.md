

# Settle Hedge Tracker + Wire Missing Matchup Intelligence

## Two Problems Found

### 1. `settle-hedge-tracker` exists but is NOT wired into any pipeline
The function was created but never added to:
- `data-pipeline-orchestrator` (nightly settlement pipeline, Phase 4)
- `sync-and-verify-all` (the cron-triggered settlement)
- No cron job schedules it

Result: 426+ hedge tracker rows remain unsettled with no accuracy data.

### 2. `matchup-intelligence-analyzer` exists but is NOT called in the main pipeline
The `matchup_intelligence` table is populated by `matchup-intelligence-analyzer` (action: `analyze_batch`), which is only referenced in `engine-cascade-runner` — but `engine-cascade-runner` is **not called** by `refresh-l10-and-rebuild` (the main 5:30 PM pipeline). The main pipeline calls `bot-matchup-defense-scanner` (which writes to `bot_research_findings`, not `matchup_intelligence`).

Result: `matchup_intelligence` table stays empty. `sharp-parlay-builder` and `heat-prop-engine` query it for blocked picks but get nothing — no matchup-based blocking happens.

---

## Fix 1: Wire `settle-hedge-tracker` into nightly pipeline

**File**: `supabase/functions/data-pipeline-orchestrator/index.ts`

Add after line 278 (after `bot-settle-and-learn` and simulation settlement):
```typescript
await runFunction('settle-hedge-tracker', {});
```

This ensures hedge accuracy gets settled every night alongside parlay settlement.

## Fix 2: Wire `matchup-intelligence-analyzer` into pre-generation pipeline

**File**: `supabase/functions/refresh-l10-and-rebuild/index.ts`

Add a call to `matchup-intelligence-analyzer` in **phase3a** (pre-generation tasks), alongside the existing `bot-matchup-defense-scanner`:

```typescript
// In phase3a parallel array, add:
["Matchup intelligence analysis", "matchup-intelligence-analyzer", { action: 'analyze_batch' }],
```

This populates `matchup_intelligence` before `sharp-parlay-builder` and `heat-prop-engine` run in phase3d, so their blocked-pick queries actually work.

## Fix 3: Run `settle-hedge-tracker` immediately

Invoke `settle-hedge-tracker` now to grade all outstanding unsettled hedge recommendations and send the accuracy report to Telegram.

---

## Files Changed

1. **`supabase/functions/data-pipeline-orchestrator/index.ts`** — Add `settle-hedge-tracker` to Phase 4 settlement
2. **`supabase/functions/refresh-l10-and-rebuild/index.ts`** — Add `matchup-intelligence-analyzer` to phase3a
3. **Invoke `settle-hedge-tracker`** — Run immediately to settle backlog

