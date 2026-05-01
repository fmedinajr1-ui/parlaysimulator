## Fix: No-HR Telegram broadcast silently skipped

### Root cause
`mlb-no-hr-team-analyzer` calls `bot-send-telegram` with `admin_only: false`. The bot explicitly returns `skipped: true` for that flag (only admin chat is configured), so every broadcast is dropped silently.

### Changes

**1. `supabase/functions/mlb-no-hr-team-analyzer/index.ts`**
- Line 322: change `admin_only: false` → `admin_only: true` (matches the working pattern in `fanduel-boost-telegram` and `sweet-spot-telegram-sync`).
- Capture the response from `supabase.functions.invoke("bot-send-telegram", ...)`. If `data.success !== true` or `data.skipped === true`, log a warning and skip the `broadcast_sent_at` stamp.
- After a confirmed send, stamp `broadcast_sent_at = now()` on the matching `mlb_no_hr_team_analysis` rows for today's `(team, game_date)`.
- Update the function's return JSON to include `broadcast_delivered: <count>` separate from `broadcast_attempted`.

**2. Migration: add delivery-tracking column**
```sql
alter table public.mlb_no_hr_team_analysis
  add column if not exists broadcast_sent_at timestamptz;
create index if not exists idx_no_hr_broadcast_sent
  on public.mlb_no_hr_team_analysis (game_date, broadcast_sent_at);
```

**3. Re-broadcast today's picks**
After deploy, invoke `mlb-no-hr-team-analyzer` once with `{}` so today's 3 A-tier picks (Rangers, Blue Jays, Marlins) actually land in Telegram, then verify via `broadcast_sent_at`.

**4. Memory update**
Add a constraint to `mem://logic/betting/no-hr-team-model.md`: "Telegram broadcasts must use `admin_only: true` — `bot-send-telegram` rejects `false` with a silent skip."

### Out of scope
- TikTok-style feed cards (cancelled per your message).
- Tier thresholds / model math — unchanged.
- No new tests required (one-line config fix + observability), but I'll add one assertion in the existing analyzer flow that the invoke response shape is checked.
