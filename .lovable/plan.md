

## Plan: Fix `tierConfig is not defined` Runtime Error

### Root Cause
Line 6606 references `tierConfig.maxPlayerUsage` but the variable is actually named `config` (defined at line 6039 as `const config = { ...TIER_CONFIG[tier] }`). This was introduced in the previous edit when adding the matchup diversity relaxation.

### Fix
**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

Change line 6606 from:
```typescript
if (tierConfig.maxPlayerUsage < 4) tierConfig.maxPlayerUsage = 4;
```
to:
```typescript
if (config.maxPlayerUsage < 4) config.maxPlayerUsage = 4;
```

Then redeploy and trigger the exploration tier generation run.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Fix variable name `tierConfig` → `config` on line 6606 |

