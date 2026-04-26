---
name: parlay-broadcast-mapping
description: Telegram parlay messages must store both parlay_id and parlay_date; broadcaster filters by ET parlay_date and dedups per (chat_id, parlay_id).
type: feature
---
Every Telegram parlay message that goes out via `parlay-engine-v2-broadcast` must
create a row in `bot_parlay_broadcasts` with all of:
  - `parlay_id` (FK to `bot_daily_parlays.id`, ON DELETE CASCADE)
  - `parlay_date` (the run-date the parlay belongs to, in ET)
  - `chat_id`
  - `telegram_message_id`

Rules the broadcaster must follow:
  1. Pull candidate parlays with `parlay_date = etDateKey()` (Eastern Time).
  2. Dedup by `(chat_id, parlay_id)` against `bot_parlay_broadcasts`.
  3. On send, insert `parlay_date: p.parlay_date` so the mapping is
     self-verifying without a join.

Audit query (one-liner): `select * from v_parlay_broadcast_audit where status <> 'OK';`
Status values: OK, MISSING_PARLAY, STORED_DATE_MISMATCH, SEND_DATE_DRIFT.

Other Telegram senders (`bot-send-telegram`, `fanduel-boost-telegram`, etc.) are
admin/notification senders and do NOT claim a parlay-row mapping — they should
not write to `bot_parlay_broadcasts`.
