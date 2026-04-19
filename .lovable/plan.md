
# ParlayIQ Pipeline v2 — Phased Rebuild

Drop the 13 v2 files into the right places, add 3 tables, keep v1 alive in compat mode while migrating. Match the uploaded `MIGRATION.md` exactly.

## Scope assessment
- **13 v2 files** ready to drop (constants, voice, pick-formatter, telegram-client, edge-calc, date-et, narrative-state, new bot-send-telegram, new telegram-webhook, generator-template, schema-additions.sql, README, MIGRATION)
- **1 missing piece**: `orchestrator-daily-narrative/index.ts` — referenced everywhere but not in the upload set. We'll build a v1 stub that just runs the dawn brief / settlement story / tomorrow tease using `bot_day_state` and existing parlay tables. Full multi-phase orchestrator is a follow-up.
- **3 new tables** via migration
- **2 functions to replace**: `bot-send-telegram` (v1→v2 thin dispatcher), `telegram-webhook` (5,300-line monster→330-line command surface)
- **13 direct-API bypasses** to leave alone in this pass (Phase 3 work)
- **99 functions** sending `{type, data}` payloads — will route through compat shim, no immediate change required

## What gets built (this loop)

### A. Database (1 migration)
Run `schema-additions.sql` exactly as uploaded:
- `bot_day_state` (date PK, phases_completed[], day_notes jsonb)
- `bot_message_log` (every send, with reference_key for callbacks)
- `bot_daily_picks` (canonical pick table — generators target this in Phase 3)
- `v_recent_messages_by_key` view
- RLS enabled, service-role only

### B. Shared libs — `supabase/functions/_shared/` (7 files)
Drop verbatim from uploads:
- `constants.ts` — Pick type, DayPhase, PROP_LABEL_SHORT/LONG, formatPropLabel (null-safe, fixes H1)
- `date-et.ts` — etDateKey, etDateKeyDaysAgo, etHour, etWeekStart (replaces scattered copies)
- `edge-calc.ts` — americanToDecimal, EV math, hasMeaningfulEdge, recency divergence (fixes M3)
- `voice.ts` — MessageBuilder, greetings, callbacks, bold/italic helpers
- `pick-formatter.ts` — renderPickLine, renderPickCard, renderPickSummaryList, renderSettledLeg
- `telegram-client.ts` — sendToChat, fanoutToCustomers (token bucket, chunking, parse-mode fallback, message log) — fixes C1/H3/H4/H5/H6
- `narrative-state.ts` — bot_day_state interface, phase tracking, callback loader

### C. New `bot-send-telegram/index.ts` (thin dispatcher)
Replace the 1,500-line v1 file with the 181-line v2 dispatcher. **Critical**: include the compat shim from MIGRATION.md so v1 callers don't 410:

```ts
const compatMode = Deno.env.get('DISPATCHER_VERSION') !== 'strict'; // default = compat
if (compatMode && body.type && !body.message) {
  body.message = body.data?.message || body.data?.text || `[${body.type}] (legacy payload — migrate)`;
  console.warn(`[dispatcher] COMPAT: type='${body.type}'`);
}
```
Default `DISPATCHER_VERSION=compat`. Flip to `strict` only after Phase 3 migrations done.

### D. New `telegram-webhook/index.ts` (command surface)
Replace v1 5,300-line file with the 330-line v2 file. Adds:
- `X-Telegram-Bot-Api-Secret-Token` header validation (fixes C2)
- Fail-closed if `TELEGRAM_WEBHOOK_SECRET` env unset (fixes C3)
- Commands: `/start /today /why /edge /pulse /record /help`
- Auth: admin bypass, `bot_authorized_users` for everyone else

### E. Generator template
Drop `generator-template/index.ts` as the canonical reference. Not deployed as live cron — just sits as the copy-from pattern for Phase 3.

### F. Minimal orchestrator stub (`orchestrator-daily-narrative/index.ts`)
Since the full file wasn't uploaded, build a minimal version that:
- Reads `bot_day_state` for today
- Determines current phase from ET hour (8a dawn / 11a slate / 11p tomorrow tease)
- Renders message via voice + pick-formatter
- Sends through new dispatcher
- Marks phase complete in `bot_day_state.phases_completed`
- Idempotent (skips phases already in array)
- Accepts `{ force_phase: '...' }` body for manual trigger

Pick-drops, pre-game pulse, live tracker, settlement story phases get TODO stubs that log "not yet implemented" — flesh out in follow-up loops once we've validated dawn/slate/tomorrow.

### G. Cron for orchestrator
`pg_cron` job hitting `orchestrator-daily-narrative` every 5 minutes. Inserted via `supabase--insert` (project-specific URL/key).

### H. Required env vars (user must set)
- `TELEGRAM_WEBHOOK_SECRET` — random string, then run the `setWebhook` curl from MIGRATION.md Phase 0
- `DISPATCHER_VERSION` — defaults to `compat`, leave unset for now

I'll list these clearly so user can add them; will not block deploy on `DISPATCHER_VERSION` since it defaults safely.

## What does NOT change (this loop)
- Existing 99 generators sending `{type, data}` — keep working via compat shim, log warnings
- 13 direct-api.telegram.org callers — keep working untouched (Phase 3 cleanup)
- `bot_daily_parlays`, `bot_settings`, `bot_authorized_users`, `straight_bet_tracker` — read-only from v2 perspective
- Frontend, blog, analytics — zero touch
- Existing crons (morning-prep-pipeline, send-slate-advisory, etc.) — leave running, don't disable broadcast triggers yet (per MIGRATION Phase 4 — that's a separate loop)

## Risk + rollback
- **Risk**: New `telegram-webhook` removes 5,000 lines of legacy command handling (PrizePicks scraper text input, password attempts, manual parlay entry). These will stop responding until reimplemented.
- **Mitigation**: Keep v1 webhook code archived as `telegram-webhook-v1-backup/` directory so we can restore individual command handlers later.
- **Rollback**: Set `DISPATCHER_VERSION=compat` (already default), disable orchestrator cron, restore v1 webhook from backup folder. Shared libs are pure-additive.

## Testing (per project policy: 5 verifications)
After deploy I'll:
1. Curl webhook without secret → expect 401
2. Curl webhook with bad secret → expect 401
3. Send `/start` → expect welcome message
4. Send `/today` → expect pick list (or empty-state message)
5. Force-trigger orchestrator with `{force_phase:'dawn_brief'}` → expect message + log row in `bot_message_log`
6. Confirm legacy `{type:'slate_status_update', data:{...}}` still delivers (compat shim) and logs deprecation warning

## Files touched
**Create:**
- `supabase/functions/_shared/{constants,date-et,edge-calc,voice,pick-formatter,telegram-client,narrative-state}.ts`
- `supabase/functions/generator-template/index.ts`
- `supabase/functions/orchestrator-daily-narrative/index.ts`
- `supabase/functions/telegram-webhook-v1-backup/index.ts` (archive of current)

**Replace:**
- `supabase/functions/bot-send-telegram/index.ts`
- `supabase/functions/telegram-webhook/index.ts`

**DB:**
- Migration: 3 tables + 1 view + RLS
- Insert (not migration): pg_cron job for orchestrator

**No changes to:** any of the 99 existing generators, frontend, analytics, blog system.

## After this loop ships
Phase 3 (next loop): migrate top 4 highest-volume generators to write to `bot_daily_picks` instead of formatting their own messages — `generate-rbi-parlays-v2`, `generate-sb-over-parlays`, `generate-cross-sport-parlays-v2`, `nba-bench-under-generator-v2`. Then settle, hedge, fanduel alerts. Then flip `DISPATCHER_VERSION=strict`.
