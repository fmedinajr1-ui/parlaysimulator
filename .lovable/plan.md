

## Add `detect-mispriced-lines` to Pipeline Phase 2

### Change

Add a single line to the Phase 2 (Analysis) block in `supabase/functions/data-pipeline-orchestrator/index.ts`. The mispriced line detector should run **after** the other analyzers so it has fresh odds and stats data to work with. It will also automatically trigger the `high-conviction-analyzer` downstream (already wired in from the previous change).

### Modified File

**`supabase/functions/data-pipeline-orchestrator/index.ts`** -- line ~124, inside the Phase 2 block:

```
// ============ PHASE 2: ANALYSIS ============
if (mode === 'full' || mode === 'analyze') {
  await runFunction('category-props-analyzer', { limit: 100 });
  await runFunction('auto-refresh-sharp-tracker', {});
  await runFunction('whale-signal-detector', { sports: [...] });
  await runFunction('team-bets-scoring-engine', {});
  await runFunction('bot-game-context-analyzer', {});
  await runFunction('detect-mispriced-lines', {});        // <-- NEW
}
```

Placing it last in Phase 2 ensures all odds, stats, and context data are refreshed before the mispriced line scan runs. Since `detect-mispriced-lines` already chains into `high-conviction-analyzer` and sends Telegram reports, no other wiring is needed.

### Files

| Action | File |
|--------|------|
| Modify | `supabase/functions/data-pipeline-orchestrator/index.ts` (add 1 line to Phase 2) |

