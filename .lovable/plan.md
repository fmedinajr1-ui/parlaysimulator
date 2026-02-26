
## What’s actually valid right now vs not valid

### Valid (working as designed)
1. **Clean & Rebuild step wiring** for:
   - `sharp-parlay-builder` with `action: "build"`
   - `heat-prop-engine` with `action: "build"`
2. **Force fresh mispriced** is behaving correctly:
   - It skipped because **12 mispriced parlays were already active** (its saturation guard threshold is 10+).
3. **Lottery scanner** is executing and returning payload successfully.

### Not valid (root causes of “same thing, same result”)
1. **Quality regen attempt-scoring is misattributed**
   - The regen loop filters by `selection_rationale like %quality_regen_attempt_X%`.
   - Generated parlays do **not** include this source tag in `selection_rationale`.
   - So each attempt falls back to “all pending”, causing additive 11→22→33 scoring and misleading attempt quality behavior.
2. **Strategy diversity cap is applied per generation run, not per final daily slate**
   - The trim exists, but it runs inside each attempt/run.
   - Across 3 attempts, `mispriced_edge` can still accumulate (12/33 = 36%).
3. **Sharp builder has insufficient source rows**
   - For today, only **2 approved risk-engine picks** exist.
   - Builder can’t create robust multi-parlay output from that.
4. **Heat builder is called without fresh tracker ingestion**
   - `build` reads `heat_prop_tracker`, but tracker had **0 future eligible rows**.
   - That leads to `INSUFFICIENT_PROPS` and no CORE/UPSIDE results.

---

## High-impact suggestions (to break the loop)

### Suggestion 1 (must-do): Make regen attempts traceable and score only their own output
- Add a persistent attempt marker (e.g., `regen_source`) into each generated parlay record context (at minimum in `selection_rationale`, ideally dedicated metadata).
- In `bot-quality-regen-loop`, remove fallback-to-all behavior for attempt scoring when marker is missing.
- If marker match returns 0, treat that attempt as failed attribution (not as global slate).

**Why:** This is the main reason repeated retries keep giving confusing outcomes.

---

### Suggestion 2 (must-do): Add a post-rebuild **daily** diversity rebalance pass
- After all generation steps complete, run one final cap pass on pending daily slate:
  - cap by base strategy family (e.g., `mispriced_edge`) against **actual pending count**
  - void or demote excess entries above 30%
- Do not rely only on in-run caps.

**Why:** Current cap can be “correct per run” yet still fail for full-day composition.

---

### Suggestion 3: Split Heat into explicit `scan -> build` steps in Clean & Rebuild
- Insert `heat-prop-engine` with `action: "scan"` immediately before `action: "build"`.
- If scan yields `< 2 eligible`, stop build and report a clear blocker toast.

**Why:** Build currently depends on tracker state that isn’t guaranteed to be refreshed.

---

### Suggestion 4: Add Sharp fallback source when approved risk picks are too thin
- In sharp builder:
  - if approved `nba_risk_engine_picks` < minimum threshold (e.g., 6),
  - fallback to high-confidence `category_sweet_spots` candidates for same date.
- Keep strict filters but avoid zero-output days.

**Why:** Today’s sharp output was 0 because source pool itself was only 2 rows.

---

### Suggestion 5: Replace fixed quality target with adaptive target band
- Instead of static 35 every day:
  - compute attempt-1 baseline and set pass target to `baseline + delta` (e.g., +1.0) capped within [33, 36].
- Keep max attempts=3.

**Why:** Avoid over- or under-shooting and repeated meaningless retries.

---

## Recommended implementation sequence (lowest risk first)

1. **Attribution fix for quality attempts** (Suggestion 1)  
2. **Heat scan-before-build in UI flow** + fail-fast messaging (Suggestion 3)  
3. **Sharp thin-pool fallback** (Suggestion 4)  
4. **Daily diversity rebalance step** (Suggestion 2)  
5. **Adaptive target band** (Suggestion 5)

This order gives quick stability first, then quality optimization.

---

## Technical implementation outline

### A) `bot-generate-daily-parlays`
- Persist incoming `source`/attempt marker into generated record rationale/metadata.
- Add optional `run_id` to every generated row in that invocation.
- Keep existing per-run trim, but add output fields to support downstream daily rebalance.

### B) `bot-quality-regen-loop`
- Score only rows attributable to current attempt (`source` or `run_id`).
- If 0 attributable rows, mark attempt as attribution failure (do not score all pending).
- Optional: adaptive target mode.

### C) `src/components/market/SlateRefreshControls.tsx`
- In Clean & Rebuild steps:
  - `heat-prop-engine` scan/ingest before build
  - parse build response to surface “insufficient props” as explicit user-facing status
- Keep sharp/heat build calls, but add “data unavailable” toast categories.

### D) `sharp-parlay-builder`
- Add fallback source branch when approved risk picks are below threshold.
- Log clear source diagnostics (`risk_rows`, `fallback_rows`, `saved_count`).

### E) New backend pass (or augment existing orchestrator)
- End-of-pipeline diversity rebalance over full `bot_daily_parlays` pending set for the day.
- Cap strategy families at 30% of actual pending count.

---

## Success criteria (what “working” should look like)

1. Quality attempts show non-cumulative attribution (attempt 2 scores only attempt 2 output).
2. Daily pending strategy concentration obeys 30% family cap.
3. Heat produces either:
   - CORE/UPSIDE results, or
   - explicit “insufficient eligible after scan” reason.
4. Sharp produces non-zero output when fallback source is available.
5. Pipeline logs become explanatory (not just successful HTTP 200 with hidden empty results).

---

## Validation checklist after implementation
1. Run one Clean & Rebuild.
2. Confirm quality regen response has per-attempt unique IDs/counts (not 11→22→33 unless truly cumulative by design and tagged).
3. Query daily pending strategy distribution and verify no family >30%.
4. Confirm `heat_prop_tracker` has fresh rows before heat build.
5. Confirm sharp logs show source counts and either saved parlays or explicit data scarcity reason.
