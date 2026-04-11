
Goal: eliminate the Telegram `/pptennis` ON CONFLICT error.

What I found
- The failing statement is still `supabase.from('pp_snapshot').upsert(..., { onConflict: 'market_key' })` in both text and screenshot flows in `supabase/functions/telegram-webhook/index.ts`.
- In the repo, I can see a migration that adds `market_key` plus a unique index for `unified_props`, but I do not see any migration that adds a unique constraint/index for `pp_snapshot.market_key`.
- `pp_snapshot` was originally created with only a normal index on `market_key`, not a unique one, so Postgres rejects `ON CONFLICT (market_key)` exactly as shown in your screenshot.
- The earlier `current_line` / `commence_time` webhook fix is already present, so the blocking issue now is the missing `pp_snapshot` uniqueness.

Implementation plan
1. Add one idempotent database migration for `pp_snapshot`
   - Deduplicate existing `pp_snapshot` rows by `market_key` first, keeping the newest row per key.
   - Add a unique index/constraint on `public.pp_snapshot(market_key)`.
   - Make it safe to rerun.

2. Harden the same migration for `unified_props`
   - Re-check that `market_key` exists.
   - Ensure the partial unique index on `market_key WHERE market_key IS NOT NULL`.
   - If duplicate `market_key` rows exist there, dedupe before creating the index so the migration cannot fail halfway.

3. Keep the webhook import logic largely unchanged
   - Preserve `current_line`, `commence_time`, `category`, and `market_key` in both `/pptennis` code paths.
   - Do not touch `src/integrations/supabase/types.ts`; it should refresh from the schema automatically.

4. Validate end-to-end
   - Test `/pptennis` with pasted text.
   - Test `/pptennis` with a screenshot caption.
   - Confirm both flows write to `pp_snapshot` and `unified_props` without the ON CONFLICT error.
   - Run `/runtennis` to confirm the analyzer sees the imported props.

Technical details
```text
Current blocker
telegram-webhook -> pp_snapshot.upsert(... onConflict: 'market_key')
                                   |
                                   v
No UNIQUE/EXCLUSION constraint on pp_snapshot.market_key
                                   |
                                   v
Postgres error: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
```

Files involved
- `supabase/functions/telegram-webhook/index.ts`
- new migration in `supabase/migrations/*`

Expected result
- `/pptennis` text imports succeed
- `/pptennis` screenshot imports succeed
- repeated imports update the same rows instead of erroring
- `/runtennis` can read the imported props immediately
