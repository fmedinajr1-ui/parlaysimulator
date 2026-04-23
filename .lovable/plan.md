
Goal: get something live today by invoking the repaired upstream pipeline in the safest order, verifying where it still blocks, and using the fastest available recovery path to produce real picks instead of leaving the system at zero.

What I will do

1. Trigger the upstream refresh in production order
- Invoke `refresh-todays-props` first to repopulate today’s real lines.
- Invoke `nba-player-prop-risk-engine` immediately after to rebuild approved risk rows from the refreshed slate.
- Invoke `refresh-l10-and-rebuild` to run the full orchestrated rebuild and let it generate parlays/straights if the preflight gates pass.

2. Inspect each response instead of blindly rerunning
- Capture the returned diagnostics from:
  - `refresh-todays-props` (`inserted`, `events`, `data_source`, freshness timestamps)
  - `nba-player-prop-risk-engine` (`approvedCount`, `blockedReason`, `topRejectionReasons`)
  - `refresh-l10-and-rebuild` (`block_code`, generated counts, freshness summary)
- Use those results to determine whether the blocker is:
  - no props for today
  - stale odds
  - risk engine empty/thin
  - no usable matches downstream

3. Use the fastest recovery branch based on the actual blocker
- If odds are missing/stale:
  - rerun `refresh-todays-props` with the fallback option enabled
  - confirm fresh FanDuel / primary-book rows were inserted
- If risk is empty/thin:
  - rerun `nba-player-prop-risk-engine` with full-slate analysis and inspect rejection mix
  - verify fresh rows exist before attempting another orchestration pass
- If direct-source matching is the remaining issue:
  - inspect `bot-leg-production-diagnostics` to see whether rows are failing on no match, stale line, missing side price, or line drift

4. Surface something actionable in the UI immediately
- Wire the existing recovery controls to show the exact block code and counts returned by the invoked functions.
- Prefer the main rebuild control already used in `SlateRefreshControls` so one click can both invoke and summarize the result.
- If output is still blocked, display the plain-language reason in the existing diagnostics panels instead of a generic “0 outputs.”

5. Deliver a short operations outcome
- Confirm one of these end states:
  - “Recovered: fresh props + approved risk rows + generated outputs”
  - or a precise blocker with counts, for example:
    - “Props loaded, but risk engine only approved 3 rows”
    - “Risk rows exist, but 0 legs survived book matching”
    - “No real lines for today were returned upstream”
- If recovery succeeds, point the app to the produced pool so picks are immediately accessible.

Files/areas involved
- `src/components/market/SlateRefreshControls.tsx` — best existing launch point for invoking the repaired pipeline
- `src/components/bot/ShadowPicksFeed.tsx` — already shows diagnostics; can display post-invoke status
- `src/hooks/usePipelinePreflight.ts` — reads latest preflight block state
- `src/hooks/useBotLegDiagnostics.ts` / `src/pages/BotLegDiagnostics.tsx` — best source for exact downstream failure mode
- `supabase/functions/refresh-todays-props/index.ts`
- `supabase/functions/nba-player-prop-risk-engine/index.ts`
- `supabase/functions/refresh-l10-and-rebuild/index.ts`
- `supabase/functions/bot-leg-production-diagnostics/index.ts`

Technical details
- The current frontend already has working invocation paths for:
  - `refresh-todays-props` in `EngineDashboard`
  - `refresh-l10-and-rebuild` in `SlateRefreshControls`
  - `bot-leg-production-diagnostics` via `useBotLegDiagnostics`
- The repaired backend now returns stage-specific block codes such as:
  - `blocked:no_props_for_today`
  - `blocked:stale_odds`
  - `blocked:risk_empty`
  - `blocked:risk_thin`
  - `blocked:no_usable_matches`
- The implementation work is mainly operational invocation plus tighter result-handling so the app can either:
  - produce picks now, or
  - tell us exactly why it still cannot.

Expected outcome
- Best case: today’s real-line pool is repopulated and the rebuild produces usable picks.
- Fallback case: we still leave with a definitive blocker and exact counts, not another ambiguous zero-output state.
