# Telegram ↔ Parlay Mapping Audit

## Result of the audit

I verified every Telegram message sent by the parlay broadcaster against its corresponding `bot_daily_parlays` row.

**Findings:**
- **9 broadcasts** in `bot_parlay_broadcasts` total (matches what's been sent).
- **0 missing parlays** — every `parlay_id` in a broadcast row resolves to a real parlay.
- **0 date mismatches** — every parlay's `parlay_date` matches the Eastern-Time date the message was sent.
- **0 duplicate sends** — no `(parlay_id, chat_id)` pair was broadcast twice.

Sample (most recent):
```text
sent_at (ET date)   parlay_date   strategy             tier      msg_id   status
2026-04-26          2026-04-26    optimal_combo        EDGE      28844    OK
2026-04-26          2026-04-26    mega_lottery_scanner LOTTERY   28843    OK
2026-04-26          2026-04-26    optimal_combo        EDGE      28842    OK
2026-04-26          2026-04-26    mega_lottery_scanner LOTTERY   28841    OK
2026-04-26          2026-04-26    optimal_combo        EDGE      28840    OK
2026-04-21          2026-04-21    double_confirmed     EDGE      28556    OK
…
```

**Conclusion: there is no current join/filter mismatch to fix.** The broadcaster (`parlay-engine-v2-broadcast`) correctly:
1. Pulls parlays via `parlay_date = targetDate` (ET).
2. Looks up dedup state via `chat_id + parlay_id`.
3. Records the resulting Telegram `message_id` keyed by `parlay_id` after each successful send.

## Hardening proposal (small, defensive)

Even though nothing is broken today, the join is implicit (no FK, no index, no monitor). I'd like to add three lightweight guardrails so any future drift is caught immediately:

1. **Add a foreign key + index** on `bot_parlay_broadcasts.parlay_id → bot_daily_parlays(id) ON DELETE CASCADE`, plus an index on `(chat_id, parlay_id)` to speed the dedup lookup.
2. **Stamp `parlay_date` onto the broadcast row** (new column `parlay_date date`) and write it at insert time inside `parlay-engine-v2-broadcast`. This makes the Telegram↔parlay mapping self-verifying without a join.
3. **Add a verification view** `v_parlay_broadcast_audit` that exposes `(broadcast_id, parlay_id, parlay_date, sent_et_date, status)` so any future "did message N map to parlay X on date Y?" question is one query, not a script.

## Files to touch

- New migration: add column, FK, index, and view described above.
- `supabase/functions/parlay-engine-v2-broadcast/index.ts`: include `parlay_date: p.parlay_date` in the `bot_parlay_broadcasts.insert(...)` payload.
- `mem/logic/parlay/broadcast-mapping.md` (new): pin the rule "every Telegram parlay message must store `parlay_id` and `parlay_date`; broadcaster must filter by ET `parlay_date`".

## Out of scope

- No change to message format, dedup window, or accuracy gates.
- No change to other Telegram senders (`bot-send-telegram`, `fanduel-boost-telegram`, etc.) — they are admin/notification senders and don't claim a parlay-row mapping.
