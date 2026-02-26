

## Findings: Edge Functions NOT Yet Deployed

The activity logs confirm the **old code** ran during the last Clean & Rebuild:

### Evidence from Logs
- **Quality Regen** (17:44 UTC): Still used `target=60%` (should be 45%) and scored `0.7%` (should use `combined_probability`). All 3 attempts failed the target. This means our scoring fix and target change are **not live**.
- **Force-Fresh Parlays**: No log entry at all -- either it didn't run or didn't log with our new saturation guard.
- **Current state**: 97 voided parlays, 0 pending. The slate is empty.

### Root Cause
The code changes were saved to the repository but the edge functions were **not redeployed** to the backend. The live functions are still running the old broken logic.

### Action Plan

**Step 1: Deploy all 3 updated edge functions**
- `bot-quality-regen-loop` (scoring fix + 45% target + skip_void flag)
- `bot-force-fresh-parlays` (saturation guard + 10 cap)
- `bot-generate-daily-parlays` (strategy diversity cap + promotion limit)

**Step 2: Trigger a Clean & Rebuild**
- Use the dashboard button to run the full 12-step pipeline
- This time it will use the deployed fixes

**Step 3: Verify via logs**
- Check `bot_activity_log` for `quality_regen` event showing `target=45%` and realistic hit rates (40-55%)
- Confirm pending parlays exist after the rebuild completes
- Verify no single strategy exceeds 30% of output

