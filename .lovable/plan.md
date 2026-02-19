
# Bot Output Integrity Check — Lightweight Edge Function

## What This Builds

A new edge function `bot-parlay-integrity-check` that:
1. Queries `bot_daily_parlays` for today's date
2. Counts any parlays with `leg_count = 1` or `leg_count = 2`
3. If violations found: fires a Telegram alert with full details (strategy names, how many, leg breakdown)
4. If clean: logs a silent "all clear" to `bot_activity_log` (no Telegram noise)
5. Gets called automatically at the END of `bot-generate-daily-parlays` — after step 10 (the existing Telegram notification)

## Where It Plugs In

The call is injected into `bot-generate-daily-parlays/index.ts` immediately after line 6122 (after the `tiered_parlays_generated` Telegram call). This means every generation run — whether triggered by cron, `bot-review-and-optimize`, or manual trigger — automatically runs the check. No separate cron needed.

## New Edge Function: `bot-parlay-integrity-check`

**File**: `supabase/functions/bot-parlay-integrity-check/index.ts`

### Logic Flow

```text
1. Accept POST with optional { date: 'YYYY-MM-DD' } (defaults to today ET)
2. Query bot_daily_parlays WHERE parlay_date = today AND leg_count IN (1, 2)
3. If violations.length === 0:
   - Insert bot_activity_log: event_type='integrity_check_pass', severity='info'
   - Return { clean: true, violations: 0 }
4. If violations.length > 0:
   - Group by leg_count (how many 1-leg, how many 2-leg)
   - Extract strategy names from the bad parlays
   - Call bot-send-telegram with type='integrity_alert'
   - Insert bot_activity_log: event_type='integrity_check_fail', severity='error'
   - Return { clean: false, violations: count, details: [...] }
```

### Telegram Alert Format (new `integrity_alert` type in `bot-send-telegram`)

```
⚠️ PARLAY INTEGRITY ALERT — Feb 19

Leak detected in today's parlays:
  1-leg singles: 3 parlays
  2-leg minis:   9 parlays

Strategies involved:
  • premium_boost_mini_parlay (×6)
  • single_pick_fallback (×3)
  • whale_signal_2leg (×3)

Action required: Review bot-generate-daily-parlays
Run /admin cleanup to remove bad parlays
```

The alert bypasses quiet hours — integrity failures should always wake you up.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/bot-parlay-integrity-check/index.ts` | New function — core integrity check logic |
| `supabase/functions/bot-send-telegram/index.ts` | Add `integrity_alert` to `NotificationType` union and `formatIntegrityAlert()` formatter |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add integrity check call after step 10 (line ~6122) |
| `supabase/config.toml` | Register `bot-parlay-integrity-check` with `verify_jwt = false` |

## Technical Details

### Integrity Check Function Core

```typescript
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const targetDate = body?.date || today;

const { data: violations } = await supabase
  .from('bot_daily_parlays')
  .select('id, leg_count, strategy_name, tier')
  .eq('parlay_date', targetDate)
  .in('leg_count', [1, 2]);

const oneLeg = violations?.filter(p => p.leg_count === 1) || [];
const twoLeg = violations?.filter(p => p.leg_count === 2) || [];
const total = oneLeg.length + twoLeg.length;

if (total === 0) {
  // Silent pass — log only
} else {
  // Group strategy names, send Telegram alert
  const strategies = [...new Set(violations.map(p => p.strategy_name))];
  // call bot-send-telegram with type: 'integrity_alert'
}
```

### Call from `bot-generate-daily-parlays` (after existing Telegram step)

```typescript
// 11. Run integrity check
try {
  await fetch(`${supabaseUrl}/functions/v1/bot-parlay-integrity-check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ date: targetDate }),
  });
} catch (integrityError) {
  console.error('[Bot v2] Integrity check failed:', integrityError);
}
```

### Alert Bypasses Quiet Hours

Inside the `bot-send-telegram` handler, the notification settings check is skipped for `integrity_alert` type — same pattern as `test` messages — so a 3 AM rogue single-pick insertion still fires an immediate alert.

## Expected Behavior After This Ships

- Every generation run ends with a silent pass logged to `bot_activity_log`
- If any 1-leg or 2-leg parlay ever appears again (from any future code path), Telegram fires within seconds of the generation completing
- The alert includes enough detail (strategy names + counts) to immediately identify which code path leaked
- No manual monitoring required — the system self-reports

## No Migration Required

Reads from existing `bot_daily_parlays` table. Writes to existing `bot_activity_log` table. Zero schema changes.
