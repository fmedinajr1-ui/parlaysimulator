
Fix the broken pipeline first, then optimize the shared input data layer so every backend function receives cleaner, fresher, and more consistent data.

## Phase 1 — Restore the pipeline so it actually runs end-to-end

### 1. Replace broken function calls with real, current backend steps
The current rebuild orchestrator is invoking several function names that are missing and returning 404s. I’ll audit every referenced step in `refresh-l10-and-rebuild` and classify them as:

- required generation steps
- optional alert/reporting steps
- renamed/legacy steps that should be repointed
- dead steps that should be removed

Goal:
- stop the orchestrator from calling functions that do not exist
- make required generation paths point to real deployed functions
- keep optional steps from breaking the run

### 2. Restore generation coverage for the outputs you care about
I’ll make sure the working pipeline produces:

- today’s parlays
- today’s straight bets
- sharp/heat/lottery outputs only if those generators still exist and are valid
- DNA/grade metadata only if the grading function is actually part of the current system

If a missing function was replaced by a newer one, I’ll wire the orchestrator to the newer function instead of restoring old dead code.

### 3. Make the orchestrator honest about success vs failure
Right now the UI can show a generic pipeline error even when the top-level trigger started correctly.

I’ll update the backend response so it distinguishes:
- started
- completed
- completed with warnings
- failed on required generation
- produced zero outputs

That way the frontend only shows success when the backend confirms real outputs were produced.

### 4. Fix the refresh UI messaging
In `SlateRefreshControls` I’ll update the client flow so it says:

- “Pipeline started” for long-running accepted jobs
- “Pipeline completed with warnings” when only optional steps fail
- “Pipeline failed to generate parlays/straight bets” when required steps fail
- “Pipeline complete” only when the backend confirms output rows exist

This removes the false “working”/“not working” ambiguity.

## Phase 2 — Optimize the data that feeds all functions

Once the pipeline is stable, I’ll optimize the shared data layer so the functions operate on better inputs instead of each function defending itself against bad or stale data.

### 5. Inventory the upstream data sources used by the pipeline
I’ll map what data each major function depends on, especially:

- `unified_props`
- game logs / L10 data
- injury / lineup freshness
- bookmaker-specific prop availability
- category/risk/scoring inputs
- any precomputed research or matchup tables

For each source, I’ll identify:
- freshness window
- required fields
- duplicate patterns
- null/invalid values
- naming inconsistencies
- bookmaker mismatches
- sport/date/timezone issues

### 6. Create a shared input contract for downstream functions
Instead of each function making assumptions differently, I’ll standardize the minimum required input rules for pipeline consumers.

Examples:
- canonical player name
- canonical market/prop type
- canonical side/direction
- consistent line number typing
- standardized bookmaker preference fields
- freshness timestamps in ET-aware logic
- required matchup/game identifiers

This makes the feeding layer consistent across all generation and scoring functions.

### 7. Add centralized data-quality gates before generation
Before parlay and straight-bet generation runs, I’ll add a compact validation pass that checks for:

- stale bookmaker data
- insufficient FanDuel coverage
- missing line values
- missing player/game linkage
- duplicate props
- malformed prop types
- obviously unusable rows

Instead of letting every function fail later, bad data gets filtered or flagged once upstream.

### 8. Reduce redundant reads and inconsistent filtering
Many pipelines degrade because each function re-queries the same large datasets with slightly different filters.

I’ll optimize this by:
- consolidating repeated filters where practical
- standardizing “today” and ET date handling
- aligning freshness thresholds across related functions
- narrowing reads to the columns/rows actually needed
- making sure downstream functions consume the same valid candidate pool when appropriate

This improves both reliability and performance.

### 9. Add visibility into data health
So this doesn’t become a hidden issue again, I’ll add clearer diagnostics around the inputs feeding generation:

- counts of fresh props by bookmaker
- candidate pool size before generation
- rows filtered for missing/invalid fields
- final usable records passed into key generators
- zero-output reasons returned explicitly instead of only logged

That makes it much easier to see whether failures are code issues or data-quality issues.

## Phase 3 — Validate the repaired and optimized flow

### 10. Re-run and verify the full daily flow
After implementation, I’ll verify that:

- the full pipeline can be invoked successfully
- today’s `bot_daily_parlays` rows are created
- today’s `bot_straight_bets` rows are created
- missing-function 404s are gone
- the UI reports the correct state
- the candidate data flowing into major functions is fresher and cleaner than before

## Files likely involved
- `supabase/functions/refresh-l10-and-rebuild/index.ts`
- `src/components/market/SlateRefreshControls.tsx`
- any currently active generator functions that replace missing legacy ones
- shared upstream data readers/filters used by those functions
- possibly selected database reads/validation helpers if the data contract needs to be centralized

## Technical details
```text
Current state
UI trigger -> refresh-l10-and-rebuild
           -> calls missing legacy functions
           -> 404s on required steps
           -> zero outputs
           -> generic pipeline error

Target state
UI trigger -> refresh-l10-and-rebuild
           -> calls only real current functions
           -> validates upstream input quality
           -> runs required generators on clean candidate data
           -> returns structured status
           -> UI reports real outcome accurately
```

## Expected outcome
After this work:

- the pipeline will actually generate today’s slate again
- the UI will stop showing misleading generic errors
- the data feeding all functions will be cleaner, more consistent, and easier to debug
- later function-level tuning will be much easier because the shared input layer will be trustworthy
