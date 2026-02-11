

# Settle Feb 10 Parlays Now

## The Problem

The settlement function has a date guard on **line 273** that blocks settlement of "today's" parlays:

```typescript
targetDates = targetDates.filter(d => d < todayET);
```

Right now it's still Feb 10 in Eastern Time (~10:47 PM ET), so `2026-02-10 < 2026-02-10` is false, and the function skips it. This is normally correct (prevents settling while games are in progress), but tonight's NBA games are done.

Additionally, the request body field is `body.date`, not `body.targetDate`.

## Fix: Add a `force` flag for manual triggers

### Change 1: `supabase/functions/bot-settle-and-learn/index.ts` (lines 238-273)

Add a `force` parameter that bypasses the date guard when manually triggering settlement:

```typescript
let targetDates: string[] = [];
let forceSettle = false;
try {
  const body = await req.json();
  if (body.date) {
    targetDates = [body.date];
  }
  if (body.force === true) {
    forceSettle = true;
  }
} catch {
  // No body - use defaults
}

// ... existing default date logic stays the same ...

// Date guard: filter out today's date to prevent premature settlement
// Skip guard when force=true (for manual triggers after games are done)
if (!forceSettle) {
  targetDates = targetDates.filter(d => d < todayET);
}
```

### After deployment

Trigger settlement with:
```json
{ "date": "2026-02-10", "force": true }
```

This will settle the 7 pending parlays and accumulate the results into the existing Feb 10 activation status row.

## File Modified

- `supabase/functions/bot-settle-and-learn/index.ts` -- add `force` bypass for date guard

## Risk

Low -- the `force` flag only applies when manually calling the function with an explicit date. The cron jobs don't send `force: true`, so normal operation is unaffected.
