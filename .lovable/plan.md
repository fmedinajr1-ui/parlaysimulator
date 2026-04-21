

## Make every pick interactive — Run / Scan / Fade buttons

The ParlayFarm renderer already defines `🐕 Tail`, `❌ Fade`, `📊 Full scan` buttons (`parlayfarm-format.ts` lines 76–98), but two pieces are missing:

1. **Outbound picks aren't carrying those buttons** — most generators (`bot-generate-daily-parlays`, `bot-curated-pipeline`, etc.) build their own message text and send via `bot-send-telegram` without `reply_markup`. Result: customers see the pick but no buttons.
2. **The webhook ignores button taps** — `tail:<id>`, `fade:<id>`, `scan:<id>` callbacks land in `telegram-webhook` but are routed only to onboarding. Nothing handles them.

Plan fixes both.

---

### Part 1 — Always attach action buttons to outbound picks

**`supabase/functions/bot-send-telegram/index.ts`** — when the request body contains a `pick_id` (or `parlay_id`, or `signal_id`), auto-build a default `reply_markup`:

```
[ 🐕 Run it ]  [ ❌ Fade ]
[ 📊 Full scan ]  [ 🔕 Mute 30m ]
```

Callbacks: `run:<pick_id>`, `fade:<pick_id>`, `scan:<pick_id>`, `mute:30m:<pick_id>`.
Skip auto-attach when caller passes its own `reply_markup` or sets `no_actions: true` (admin/system messages).

This means every existing generator immediately gets buttons without code changes — they already pass `pick_id` in the payload.

### Part 2 — Handle the four button taps

**`supabase/functions/telegram-webhook/index.ts`** — add a `handlePickAction()` branch in the callback router. Parses `<action>:<pick_id>`:

| Tap | What happens |
|---|---|
| `run:<id>` | Insert into new `bot_pick_actions` table with `action='run'`, reply with `✅ Locked in. Tracking this for your record.` |
| `fade:<id>` | Insert with `action='fade'`, reply with `❌ Faded. We'll grade the opposite outcome.` |
| `scan:<id>` | Invoke a new edge function `pick-full-scan` that pulls the pick row + matchup + sharp money + last-10 + line history and replies with the long-form breakdown. |
| `mute:30m:<id>` | Insert with `action='mute_30m'`, suppress that pick's player from this chat for 30 min. |

### Part 3 — New `pick-full-scan` edge function

Loads `bot_daily_picks` row by id → fetches matchup context (`bot_research_findings`), line history (`unified_props`), L10 (`mlb_player_game_logs` / nba equivalents), and the enrichment block from `alert-enricher`. Returns a deep-dive Telegram message (uses `renderSharpSteam` from ParlayFarm format) with the full reasoning + a `🐕 Run it / ❌ Fade` button row.

### Part 4 — Persist actions for tracking

New table:

```sql
create table bot_pick_actions (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  pick_id uuid,
  parlay_id uuid,
  action text not null check (action in ('run','fade','scan','mute_30m')),
  created_at timestamptz not null default now()
);
create index on bot_pick_actions (chat_id, pick_id);
create index on bot_pick_actions (pick_id, action);
alter table bot_pick_actions enable row level security;
create policy "service role full access" on bot_pick_actions
  for all using (auth.role() = 'service_role');
```

This unlocks future per-customer P/L: a customer's record = sum of `run` outcomes minus `fade` outcomes inverted, gated by their own taps — finally a real personalized scoreboard.

### Part 5 — Mute enforcement

`telegram-client.ts` `fanoutToCustomers` already loads prefs per customer. Add a check: before sending, query `bot_pick_actions` for `action='mute_30m'` rows where `chat_id` matches and `created_at > now() - 30min` and the new pick's `player_id` matches the muted pick's player. Skip those.

### Files

**New**
- `supabase/functions/pick-full-scan/index.ts`
- New migration for `bot_pick_actions`

**Edited**
- `supabase/functions/bot-send-telegram/index.ts` — auto-attach default action keyboard when `pick_id`/`parlay_id` present
- `supabase/functions/telegram-webhook/index.ts` — route `run:`, `fade:`, `scan:`, `mute:` callbacks to new handlers
- `supabase/functions/_shared/telegram-client.ts` — mute check in fanout

### Out of scope (future)

- "Run it" auto-placing the bet via sportsbook API (Hard Rock / FanDuel) — currently just records the tap.
- A dashboard page showing customer's run/fade record. The data is captured; UI comes after we have a few weeks of taps.
- Inline editing of pick stake from the button (e.g. quarter Kelly slider).

