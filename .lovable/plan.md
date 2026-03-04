

## Analysis

The code changes (exposure cap → 3, strategy cap → 40%, lottery anchor requirements) are **already committed** from the previous implementation. The diversity rebalance function is at v2.1 with the correct caps.

However, simply re-running the rebalance won't help — it only **voids**, it never **un-voids**. The 209 parlays voided by the old stricter rules are stuck as `outcome = 'void'`. We need to restore them first, then re-run the rebalance with the relaxed rules.

## Plan

### 1. Un-void parlays that were killed by old diversity rules
Run a database update to flip parlays back to `pending` where they were voided specifically by the old diversity/exposure passes today:

```sql
UPDATE bot_daily_parlays
SET outcome = 'pending', lesson_learned = NULL
WHERE parlay_date = '2026-03-04'
  AND outcome = 'void'
  AND lesson_learned IN (
    'diversity_rebalance_cap_2',
    'diversity_rebalance_cap_3', 
    'exposure_cap_player_prop'
  );
```

This restores only diversity-voided parlays — not ones voided for other reasons (like the initial "Voided for defense-aware rebuild").

### 2. Redeploy `bot-daily-diversity-rebalance`
The function file is already updated to v2.1 with the relaxed caps, but we need to ensure the deployed version matches. Redeploy it.

### 3. Re-run the diversity rebalance
Invoke `bot-daily-diversity-rebalance` to apply the new 40% strategy cap and max-3 exposure cap against the restored slate. This should keep 15–25+ parlays active instead of 3.

### 4. Verify final count
Query `bot_daily_parlays` for today's pending count and strategy distribution to confirm adequate volume and diversity.

