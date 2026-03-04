
Goal: fix two production behavior bugs in the pipeline:
1) exposure pass metrics in `bot-daily-diversity-rebalance` are misleading, and
2) `shootout_stack` is passing legs that show sub-80 hit rates because the gate uses a different metric than the one persisted to legs.

What I found:
- In `bot-daily-diversity-rebalance/index.ts`, exposure candidates are computed correctly, but `exposureVoided` relies on `update(...).select('*', { count: 'exact', head: true })`, which is returning 0/null even when rows are actually updated.
- In `bot-generate-daily-parlays/index.ts`, the 80% gate checks `pick.l10_hit_rate`, but generated shootout legs persist `hit_rate` from `confidence_score` (and for shootout specifically it is stored as decimal, e.g. 0.74). So gate metric and stored metric are inconsistent.
- For the exact complained legs (Baylor/Derrick/Jared), raw L10 can be high while effective confidence/line-adjusted reliability is lower, which is why they still pass today.

Implementation plan:

1) Fix exposure accounting to report only real exposure voids
- File: `supabase/functions/bot-daily-diversity-rebalance/index.ts`
- Changes:
  - In strategy pass, collect actually updated IDs (not just attempted IDs) from `update(...).select('id')`.
  - In exposure pass, explicitly exclude IDs already voided by strategy pass before counting/updating.
  - Replace `head:true` count-based update tally with returned-row-length tally (`select('id')`) in chunk updates.
  - Compute `totalAfter` from a final pending recount query (source of truth), not arithmetic subtraction.
  - Keep `exposureDetails` for diagnostics, but add explicit metadata fields:
    - `exposureCandidatesRaw`
    - `exposureCandidatesAfterStrategyFilter`
    - `exposureAlreadyVoidedByStrategy`
    - `exposureVoided`
- Result: each pass’s void count reflects only what that pass actually changed.

2) Make the 80% gate use the same effective metric users see in parlays
- File: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Changes:
  - Introduce one helper to normalize any hit-rate input to percent consistently.
  - Introduce one helper/field for “effective gate hit rate” per pick (line-adjusted and confidence-aware), and use this in BOTH:
    - execution-tier gate (currently around line ~6991),
    - shootout/grind cluster gate (currently around line ~9076).
  - Align persisted leg fields for cluster parlays:
    - store `hit_rate` in percent consistently (not decimal for cluster path),
    - include explicit `l10_hit_rate` and `confidence_score` on leg object for transparency/debugging.
  - Add clear rejection logs that print raw L10, confidence, and effective gate rate so future debugging is unambiguous.
- Result: if a leg is shown below 80 in the stored `hit_rate` metric, it will no longer pass the 80 gate.

3) Deployment confidence marker (to eliminate “old code still running” ambiguity)
- Files:
  - `supabase/functions/bot-generate-daily-parlays/index.ts`
  - `supabase/functions/bot-daily-diversity-rebalance/index.ts`
- Changes:
  - Add a small version marker constant/comment and include it in log output once per run.
- Result: quick verification from logs/data that the new gate/accounting code path executed.

Technical details (concise):
- Root mismatch for L10 bug is metric drift:
  - gate = `l10_hit_rate`
  - persisted leg hit rate = `confidence_score` (and cluster path currently decimal format)
- Exposure count bug is instrumentation drift:
  - update count API usage is not reliably returning actual affected row count in current pattern.

Verification plan after implementation:
1) Run `Clean & Rebuild`.
2) Confirm latest `diversity_rebalance` activity log shows:
   - non-misleading `exposureVoided`,
   - explicit filtered candidate counters,
   - `totalAfter` matches actual pending count query.
3) Query latest `shootout_stack` (if any):
   - every leg `hit_rate >= 80` (same unit), or no shootout parlay generated if pool is too weak.
4) Confirm logs show new version marker and new gate diagnostic line format.
