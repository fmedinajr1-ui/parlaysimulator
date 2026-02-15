

# Add Force-Bypass to AI Research Agent and Test Whale Query

## Problem

The `ai-research-agent` has a deduplication guard that blocks the entire run if any findings exist for today. Since it already ran today (20 findings from the previous deployment), the new `whale_money_steam_moves` query never executes.

## Solution

Add a `force` parameter to bypass the dedup guard, then trigger a test run.

## Implementation

### File: `supabase/functions/ai-research-agent/index.ts`

**Change 1 -- Parse `force` flag from request body (~line 282)**

Before the dedup guard, parse the incoming request body for a `force: true` flag:
```ts
const body = await req.json().catch(() => ({}));
const forceRun = body?.force === true;
```

**Change 2 -- Conditionally skip dedup guard (~line 299)**

Wrap the existing dedup check so it only blocks when `forceRun` is false:
```ts
if (!forceRun && existingCount && existingCount > 0) {
  // skip...
}
```

This way, calling with `{ "force": true }` will re-run all queries including the new whale money query. Normal scheduled runs (no body) still dedup as before.

### After Deployment

Trigger a test with:
```
POST /ai-research-agent  { "force": true }
```

Then verify `whale_money_steam_moves` appears in `bot_research_findings` and the cross-reference updates any matching `whale_picks`.

### Changes Summary

| What | Where | Detail |
|------|-------|--------|
| Parse `force` flag | Line ~282 | Read from request body |
| Conditional dedup | Line ~299 | Skip guard when `force: true` |
| Redeploy + test | Post-deploy | Invoke with force, verify findings |
