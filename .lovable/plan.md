
Goal: stop exact-leg spam (same player + same prop side/line repeated across many parlays), while still allowing different props for the same player.

What I found (root causes)
1) Live data confirms the issue is real now: today has duplicates like Desmond Bane OVER 22.5 points in 6 pending parlays (plus other repeated legs).
2) The final diversity pass is not being run in your active scheduled generation flow (no diversity rebalance activity logged today), so cross-engine duplicate cleanup never executes.
3) In `bot-generate-daily-parlays`, the global exposure tracker uses inconsistent keys:
   - check uses player-only key
   - update uses player|prop key
   This mismatch makes the intended cap ineffective during generation.
4) Integrity check currently only validates 1-leg/2-leg violations; it does not detect repeated identical legs.

Implementation plan
1) Fix source-level exposure key logic in generator
- File: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Standardize one exposure key everywhere to match your requirement:
  - `player|normalized_prop|side` (optionally line if we want “exact-line only”).
- Apply this same key in:
  - preloaded existing pending usage
  - `canUsePickGlobally` check
  - usage increment when adding legs
- Result: same prop side can’t repeat across the day; different props remain allowed.

2) Enforce same rule in final safety net
- File: `supabase/functions/bot-daily-diversity-rebalance/index.ts`
- Update Pass 2 key extraction from player|prop to the same canonical key as above.
- Keep default cap at 1 for that key.
- Improve metadata log to show top offenders clearly.

3) Ensure rebalance actually runs in all generation paths
- File: `supabase/functions/data-pipeline-orchestrator/index.ts`
  - After generation/regen block, invoke `bot-daily-diversity-rebalance`.
- File: `supabase/functions/bot-force-fresh-parlays/index.ts`
  - Invoke rebalance after inserts.
- File: `supabase/functions/bot-review-and-optimize/index.ts`
  - Invoke rebalance after `bot-generate-daily-parlays` response succeeds.
(Prevents repeats even when generation is triggered from different entry points.)

4) Upgrade integrity guard so this can’t silently pass again
- File: `supabase/functions/bot-parlay-integrity-check/index.ts`
- Add duplicate-leg detection over today’s pending parlays:
  - Group by canonical leg key
  - Fail if any key count > configured cap
- Log/alert with offending keys and counts.

5) Reduce operator confusion in pipeline views
- File: `src/hooks/useBotPipeline.ts`
- File: `supabase/functions/telegram-webhook/index.ts` (`/pipeline` and optionally `/parlays`)
- Default summaries to pending/active parlays (or show explicit pending vs voided sections), so intentionally voided tickets don’t look like active duplicates.

Validation plan
1) Generate slate through normal flow.
2) Run duplicate audit query on pending parlays:
   - assert no `player|prop|side` key appears > 1.
3) Trigger alternate flows (`/fixprops`, force-fresh path, orchestrator regen) and re-run audit.
4) Confirm `/pipeline` and bot-pipeline page display matches active pending slate and no repeated same-leg spam.
5) One-time cleanup for today: run rebalance once after deploy so existing repeated legs are immediately pruned.

Technical notes
- I will keep “different props for same player” allowed.
- I will not add a global player-only cap in this fix, since you explicitly said different props are fine.
- If you want strict “exact line only” instead of prop-side cap, I can key by `player|prop|side|line` instead.
