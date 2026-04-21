

## Phase D: Auto-trigger + real book line enforcement

Two pieces:

1. **Real book lines**: harden the v2 engine so every leg's `american_odds` and `line` come straight from `unified_props` (FanDuel → DraftKings → BetMGM priority) and reject any candidate without a fresh, active book line.
2. **Auto-trigger**: pg_cron schedule that runs `parlay-engine-v2-broadcast` 3× per day so slates ship to `@parlayiqbot` without manual invokes.

No new Telegram bot, no settlement work, no UI.

---

### 1. Real book lines (engine hardening)

Current behavior in `parlay-engine-v2/index.ts`:
- Joins `bot_daily_pick_pool` to `unified_props` on `(player_name, prop_type)`.
- Uses `over_price` / `under_price` whichever side matches.
- Drops candidates with no price.

Gaps to close:

**a. Bookmaker priority (FanDuel → DraftKings → BetMGM)**  
Today the join takes whichever `unified_props` row Postgres returns first — could be BetMGM even when FanDuel has a sharper line. New behavior:
- Pull all matching `unified_props` rows for the player+prop (not just one).
- Pick the row in order: `fanduel` → `draftkings` → `betmgm`.
- Record the chosen book as `signal_source` suffix and surface it in the Telegram message: `"Luka Doncic — Points OVER 28.5 (-115) [FD]"`.

**b. Freshness gate**  
Reject any candidate whose `unified_props.odds_updated_at` is older than **20 minutes** at engine run time. Counted in `report.rejection_reasons['leg:stale_book_line']`. Tunable via `config.MAX_BOOK_LINE_AGE_MIN` (default 20).

**c. Line equality check**  
Reject candidates where `recommended_line` differs from `unified_props.current_line` by more than 0.5 (means the book moved off our pick). Counted as `leg:line_moved`. Tunable via `config.MAX_LINE_DRIFT` (default 0.5).

**d. `is_active = true` required**  
Already enforced via `line_confirmed_on_book`, but add an explicit early reject so the rejection log is clearer (`leg:book_line_inactive`).

**Engine changes** (all in `supabase/functions/parlay-engine-v2/index.ts`):
- Replace the single `propIndex` map with `propsByKey: Map<key, PropRow[]>` and a `pickPreferredBook(rows, order)` helper.
- Add freshness + drift checks inside `buildCandidates`.
- Stamp `selected_book` onto each `CandidateLeg` (new optional field on `models.ts`).

**No change to scoring or sizing.** This is purely about *trusting only fresh, real book lines*.

**Tests** (5):
1. Given props rows for [betmgm, fanduel, draftkings], picker returns the FanDuel row.
2. Stale prop (`odds_updated_at` 30 min old) is rejected with `leg:stale_book_line`.
3. Line drift (pool line 28.5 vs book 30.5) rejected with `leg:line_moved`.
4. `is_active=false` prop rejected with `leg:book_line_inactive`.
5. Telegram message rendered for a FanDuel-sourced leg includes `[FD]` suffix.

---

### 2. Auto-trigger via pg_cron

Three scheduled runs per day, all calling `parlay-engine-v2-broadcast` with `generate_first: true`:

| Slot | ET time | UTC cron | Why |
|---|---|---|---|
| Morning slate | 11:00 AM ET | `0 15 * * *` | After morning prep pipeline finishes; lines fresh |
| Midday refresh | 2:30 PM ET | `30 18 * * *` | Catches afternoon line moves before NBA tip |
| Pre-game lock | 6:00 PM ET | `0 22 * * *` | Final slate before NBA primetime |

Dedup is already handled by `bot_parlay_broadcasts (parlay_id, chat_id) UNIQUE`, so cron re-runs never double-post the same parlay. New parlays generated in later slots ship; previously-broadcast ones are skipped.

**Migration** (single SQL, has to use the insert tool because it embeds the project URL + service-role JWT — no shared remix risk):

```sql
SELECT cron.schedule(
  'parlay-iq-broadcast-morning',
  '0 15 * * *',
  $$SELECT net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/parlay-engine-v2-broadcast',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <service_role>"}'::jsonb,
    body := '{"generate_first":true,"preset":"v2.3-balanced","dry_run":false}'::jsonb
  );$$
);
-- + same for 18:30 and 22:00 UTC
```

Each job is independently `cron.unschedule`-able by name so you can pause one slot without killing the others.

**Kill switch**: a row in `bot_owner_rules` named `parlay_iq_autobroadcast_enabled` (default `true`). The broadcast function checks it at the top and returns `{paused: true}` immediately when `false`. Lets you stop posting without dropping the cron jobs.

**Tests** (3, all on the broadcast function):
1. With `parlay_iq_autobroadcast_enabled=false`, the function returns `{paused:true}` and never calls Telegram.
2. With it `true`, normal flow proceeds.
3. Two back-to-back invocations of the same slot only post once (existing dedup test, restated for cron context).

---

### What this does NOT do

- No settlement / outcome grading (still pending — separate phase).
- No new Telegram bot or inbound commands.
- No UI changes.
- Does not change the engine's strategy logic, sizing, or correlation model.
- Does not bring odds from `fetch-current-odds` directly — `unified_props` is already the canonical store and is refreshed every few minutes by your existing pipeline. Pulling from the API at engine time would burn quota.

### Sequence

1. Engine hardening in `parlay-engine-v2/index.ts` + `_shared/parlay-engine-v2/config.ts` + `models.ts` + 5 tests.
2. Add kill-switch read in `parlay-engine-v2-broadcast/index.ts` + 1 test.
3. Telegram message: append `[FD]` / `[DK]` / `[MGM]` book tag per leg.
4. Insert pg_cron schedule (3 jobs) — uses Supabase insert tool, not migration tool.
5. Manual verification: invoke once with `dry_run:true`, confirm fresh FanDuel lines and rejection reasons; flip to `dry_run:false`; wait for first cron tick.

