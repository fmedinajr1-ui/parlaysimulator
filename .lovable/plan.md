

# Why Everything Was Voided Today

## What Happened

Every parlay for March 17 is voided. Here's the timeline:

| Time (ET) | Event | Result |
|-----------|-------|--------|
| 2:00 PM | `l3_cross_engine` generated 1 parlay (5-leg) | Created as pending |
| 3:00 PM | `refresh-l10-and-rebuild` triggered (manually or old schedule) | **Step 1: Voided ALL pending parlays** (killed the l3 parlay) |
| 3:00 PM | Same run: Generated 5 new parlays | Created as pending |
| 3:00 PM | Diversity rebalance voided 1 for exposure | 4 remain pending |
| 3:07 PM | Lottery scanner generated 1 ticket | Created as pending |
| ~3:07+ PM | **Unknown second trigger** of refresh-l10-and-rebuild | **Voided all 5 remaining parlays** (4 from generation + 1 lottery) |

The smoking gun: 4 parlays show `lesson_learned: "Voided for L10-fresh rebuild"` — that string only appears in `refresh-l10-and-rebuild` line 128-132. It ran **twice**, and the second run's void step destroyed the first run's output.

## Root Cause

**Line 128-132 of `refresh-l10-and-rebuild/index.ts`** runs a blanket void on ALL pending/null parlays for today before regenerating:

```typescript
await supabase
  .from("bot_daily_parlays")
  .update({ outcome: "void", lesson_learned: "Voided for L10-fresh rebuild" })
  .eq("parlay_date", today)
  .or("outcome.eq.pending,outcome.is.null");
```

This is destructive because:
1. It kills parlays from **other engines** (l3_cross, lottery, ladder) that ran earlier
2. If invoked twice (manual + cron, or timeout retry), the second run voids the first run's fresh parlays
3. The 5:30 PM ET cron hasn't even fired yet — tonight's regeneration will work, but this same bug will recur any time there's a double invocation

## Fix

### 1. Add a generation lock to prevent double-run voiding
**File**: `supabase/functions/refresh-l10-and-rebuild/index.ts`

Before voiding, check if a successful generation already ran today. If parlays were created within the last 30 minutes, skip the void step:

```typescript
// Check if we already generated recently (prevent double-void)
const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const { count: recentCount } = await supabase
  .from('bot_daily_parlays')
  .select('*', { count: 'exact', head: true })
  .eq('parlay_date', today)
  .gte('created_at', thirtyMinAgo)
  .eq('outcome', 'pending');

if (recentCount && recentCount > 0) {
  log(`Skipping void — ${recentCount} parlays generated in last 30min`);
} else {
  // existing void logic
}
```

### 2. Protect other engines' parlays from the blanket void
Scope the void to only target parlays from `refresh-l10-and-rebuild`'s own strategies, not from l3_cross, lottery, or ladder engines:

```typescript
// Only void parlays from strategies this orchestrator manages
.not('strategy_name', 'ilike', '%l3_cross%')
.not('strategy_name', 'ilike', '%mega_lottery%')
.not('strategy_name', 'ilike', '%ladder%')
```

### 3. Immediately regenerate tonight's slate
After deploying the fix, manually invoke `refresh-l10-and-rebuild` once to generate fresh parlays for tonight's games. The 5:30 PM ET cron will also fire at 22:30 UTC, but with the lock in place it won't void the manual run's output.

## Files to Change
| File | Change |
|------|--------|
| `supabase/functions/refresh-l10-and-rebuild/index.ts` | Add generation lock + scope void to own strategies only |

