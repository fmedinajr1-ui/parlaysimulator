

## ParlayFarm Telegram rebrand — implementation plan

Replace the current alert formatting with the **ParlayFarm spec** ("Track Sharps. Tail Winners. 🐕"). All 11 templates from `parlayfarm-telegram-messages.md` get implemented. Old `alert-format-v3.ts` rendering is **deleted** in favor of the new system (with a thin compatibility shim so the 99 existing generators keep working without edits).

### Part A — Delete the old format

- Remove `supabase/functions/_shared/alert-format-v3.ts` and any direct `renderAlertCardV3` imports.
- Replace those imports with the new `parlayfarm-format.ts` entry point. Generators that built `AlertCardV3Input` keep their call sites — the shim accepts that shape and routes by `signal_type`.

### Part B — New shared renderer

**File:** `supabase/functions/_shared/parlayfarm-format.ts`

Exports one function per template (MarkdownV2 output):

| Template | Function | Trigger |
|---|---|---|
| #1 Welcome | `renderWelcome()` | `/start` |
| #2 Sharp steam | `renderSharpSteam()` | `velocity_spike`, `live_velocity_spike`, `cascade`, `live_cascade`, `line_about_to_move` |
| #3 Trap flag | `renderTrapFlag()` | `trap_warning=true` or sharp/public split ≥ 50pp |
| #4 RLM | `renderRLM()` | `reverse_line_movement=true` |
| #5 Slip verdict | `renderSlipVerdict()` | `grade-slip` output |
| #6 Daily digest | `renderDailyDigest()` | morning recap cron |
| #7 Batch digest | `renderBatchDigest()` | >3 alerts/60s for one chat |
| #8 Sticky header | `renderStickyHeader()` | pinned, refreshed every 15min |
| #9 Error / no read | `renderErrorNoRead()` | engine bailouts |
| #10 CTA footer | `renderCTAFooter()` | appended to public-channel sends |
| #11 Settings | `renderSettings()` | `/settings` command |

Helpers: `mdv2Escape()`, `confBar(pct)` (10-char `█/▒`), `divider()` (`━`×23), `headerLine(type, sport, state)`, button taxonomy from spec ("Tail it", "Fade it", "Mute 30m", "View slip", "Open chart").

### Part C — Dispatcher + batching

- `bot-send-telegram/index.ts` — accept `parse_mode: 'MarkdownV2'` and `reply_markup`. Before sending, check buffer rule: if >3 messages queued for same `chat_id` in the last 60s → insert into buffer instead of sending.
- New table `telegram_alert_batch_buffer (id, chat_id, signal_type, payload jsonb, created_at)`.
- New cron edge function `telegram-batch-flusher` (every 30s) — drains buffer per chat into `renderBatchDigest()`.

### Part D — Sticky header worker

- New edge function `parlayfarm-sticky-header` — cron every 15min. Calls `editMessageText` on the pinned message id stored in `telegram_bot_state.pinned_header_message_id`. Pulls 60-min counters from `engine_live_tracker`. If no pinned id exists, sends + pins a new one.
- Schema add: `telegram_bot_state.pinned_header_message_id bigint`, `pinned_header_chat_id bigint`.

### Part E — Wire commands + slip verdict

- `telegram-webhook/index.ts` — handle `/start` (welcome), `/today` (daily digest), `/slip` (parse + grade), `/tail`, `/settings`.
- `grade-slip/index.ts` — final response uses `renderSlipVerdict()`.

### DB migration

```sql
create table telegram_alert_batch_buffer (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  signal_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index on telegram_alert_batch_buffer (chat_id, created_at);

alter table telegram_bot_state
  add column pinned_header_message_id bigint,
  add column pinned_header_chat_id bigint;
```

Plus cron schedules for `telegram-batch-flusher` (30s) and `parlayfarm-sticky-header` (15min) — inserted via the insert tool, not migration (project-specific URL/key).

### Files

**New**
- `supabase/functions/_shared/parlayfarm-format.ts`
- `supabase/functions/telegram-batch-flusher/index.ts`
- `supabase/functions/parlayfarm-sticky-header/index.ts`
- New schema migration

**Edited**
- `supabase/functions/bot-send-telegram/index.ts` — MarkdownV2 + buffering
- `supabase/functions/telegram-webhook/index.ts` — command routing
- `supabase/functions/grade-slip/index.ts` — slip verdict template
- All generators currently importing `alert-format-v3` — swap to `parlayfarm-format` shim (single-line import change)

**Deleted**
- `supabase/functions/_shared/alert-format-v3.ts`

### Safety

- Compat shim accepts the old `AlertCardV3Input` shape so no generator logic changes.
- Buffering is opt-in by signal volume — single alerts go through immediately, no latency added.
- Sticky header is one pinned message per chat — non-destructive to history.

### Out of scope (Phase 2 follow-up)

- Inline button callback handling beyond logging clicks (Tail/Fade/Mute writes).
- Settings persistence writes from template #11.
- Rebranding non-Telegram surfaces (web, email, push).

