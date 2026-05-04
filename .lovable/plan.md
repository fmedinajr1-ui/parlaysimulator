# Configurable Cascade Thresholds — Web + Telegram Admin Control

## Goal
Move hardcoded cascade alignment cutoffs (form / defense / pace / juice / model_edge) into a DB table so they can be tuned **two ways** without redeploying:
1. Admin web UI (`/admin/alert-thresholds`)
2. Admin-only Telegram commands (so you can tune from your phone in seconds)

---

## 1. Database — `alert_thresholds`

Per-sport, per-axis row. Seeded with current v2 defaults so day-1 behavior is unchanged.

```text
alert_thresholds
  id uuid pk
  sport text         -- 'NBA' | 'MLB' | 'NFL' | 'ALL'
  axis text          -- 'form' | 'defense' | 'pace' | 'juice' | 'model_edge'
  aligned_over numeric
  aligned_under numeric
  against_over numeric
  against_under numeric
  neutral_band numeric
  notes text
  updated_at timestamptz
  updated_by text    -- 'web:<user_id>' or 'tg:<chat_id>'
  unique (sport, axis)

alert_thresholds_audit  -- insert-only history
  id, sport, axis, old_values jsonb, new_values jsonb,
  source text, actor text, changed_at timestamptz
```

RLS: read = authenticated; write = `has_role(auth.uid(),'admin')`. Telegram writes go through an edge function using the service role after verifying the chat_id is admin.

## 2. Shared loader — `_shared/threshold-config.ts`

- `getThresholds(supabase, sport)` returns typed thresholds, cached 60s in module scope.
- Falls back to hardcoded v2 defaults if table empty / query fails.
- `invalidateThresholdCache()` for write paths.

## 3. Refactor `alert-explainer.ts`

Replace every magic number in the 6 axis classifiers with `thresholds.<axis>.<field>`. Load thresholds once per alert batch in callers (`signal-alert-engine`, `signal-alert-telegram`, `cascade-verdict-audit`).

## 4. Telegram admin control — extend existing bot poller

Add a command handler in the function that already processes `telegram_messages` (the bot router). Gated to admin chat IDs from `bot_authorized_users` where `authorized_by='admin_grant'` (or a new `is_threshold_admin` flag).

Commands:

```text
/thresholds                       -> show all sports + axes, current values
/thresholds NBA                   -> show NBA only
/thresholds NBA form              -> show one axis with all 5 fields
/set NBA form aligned_over 0.50   -> update one field, log audit, invalidate cache
/reset NBA form                   -> revert axis to v2 defaults
/audit NBA 5                      -> last 5 changes for NBA
```

Each write:
- Validates sport ∈ allowed list, axis ∈ allowed list, field ∈ allowed list, value is numeric and within sane bounds (e.g. form 0–1, defense rank 1–32, juice -100..100).
- Upserts row, inserts audit entry with `source='telegram'`, `actor='tg:<chat_id>'`.
- Calls cache-invalidate (bumps `system_config.thresholds_version`).
- Replies with confirmation showing old → new value.

Reject non-admins with a single line; log attempt.

## 5. Web admin UI — `src/pages/admin/AlertThresholds.tsx`

- Gated by `useAdminRole`.
- Card per sport, row per axis, paired number inputs + slider.
- "Reset to defaults" per axis, "Save" per sport.
- Live preview: re-score last 20 settled cascades under pending vs current thresholds (calls `cascade-verdict-audit` with overrides).
- Audit log tab showing recent changes from both web and Telegram sources.

Add route in `src/App.tsx`, link in admin nav.

## 6. Cache invalidation

Tiny `invalidate-threshold-cache` function (or inline in the writers) that bumps `system_config.thresholds_version`. Loader checks version on each call; if changed, refetches. Propagation across all warm edge instances within ~60s.

## 7. Tests (5 per project rule)

1. Loader returns defaults when table empty.
2. Per-sport row overrides `'ALL'` row.
3. Form axis flips neutral→aligned when threshold lowered 0.55→0.45.
4. Telegram `/set` parser: valid command updates row + writes audit; invalid value rejected; non-admin rejected.
5. `cascade-verdict-audit` produces different verdict mix under two threshold sets on same fixtures.

## Files to create / change

```text
supabase/migrations/<ts>_alert_thresholds.sql
supabase/functions/_shared/threshold-config.ts
supabase/functions/_shared/threshold-config_test.ts
supabase/functions/_shared/alert-explainer.ts
supabase/functions/signal-alert-engine/index.ts
supabase/functions/signal-alert-telegram/index.ts
supabase/functions/cascade-verdict-audit/index.ts            (accept overrides)
supabase/functions/telegram-bot-router/index.ts              (add /thresholds, /set, /reset, /audit)
supabase/functions/invalidate-threshold-cache/index.ts
src/pages/admin/AlertThresholds.tsx
src/App.tsx
mem/logic/alerts/explainer-contract.md                       (document config layer + TG commands)
```

## Out of scope
- No verdict-math changes (STRONG/LEAN/WEAK/NEUTRAL rules unchanged).
- No auto-tuning loop; manual control only.
- Cascade engine only; take_it_now / velocity_spike continue to use defaults.

Approve and I'll implement.
