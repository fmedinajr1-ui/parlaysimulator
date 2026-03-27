

## Fix: `/parlays` Telegram Command Shows Voided Parlays

### Problem
The `/parlays` command in `telegram-webhook` fetches **all** parlays for today regardless of outcome (line 692-696). After DNA audits void low-quality parlays, the command still shows them in the count and list — making the slate look incorrect.

The `/parlay` command (line 3926) correctly filters by `outcome = 'pending'`, so only `/parlays` needs fixing.

### Fix

**File:** `supabase/functions/telegram-webhook/index.ts`

1. **Add `outcome` filter to the `/parlays` query** (line 692-696) — filter to only `pending` parlays, matching how `/parlay` and `bot-slate-status-update` already work:
   ```ts
   .eq("parlay_date", today)
   .neq("outcome", "voided")  // Exclude voided/DNA-failed parlays
   .order("created_at", { ascending: false });
   ```

2. **Add voided count context to the header** — show users how many were filtered:
   - Query total count separately (or count voided)
   - Add a line like `"(3 voided by DNA audit)"` to the header so the admin knows parlays were pruned

3. **Redeploy** the `telegram-webhook` edge function and verify via `/parlays` command.

### Scope
- Single file change (`telegram-webhook/index.ts`, ~5 lines modified)
- No database changes needed

