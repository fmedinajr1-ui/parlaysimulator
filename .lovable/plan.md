## Goal
Send admin-only Telegram alerts before every MLB game (T-30m and T-5m) with the matchup, the books currently missing a posted line for that game, a per-book latency table prioritizing Hard Rock + FanDuel + DraftKings, and the top delay catches from the last 24h.

## Pieces to build

### 1. New edge function: `mlb-pregame-latency-alert`
Runs every minute, ET-aware.

For each MLB game on today's slate (from `statsapi.mlb.com/api/v1/schedule?sportId=1&date=<ET>`):
- Compute minutes until `gameDate`.
- Fire once at T-30 (window 29–31m) and once at T-5 (window 4–6m). Dedupe via a new tiny table `mlb_pregame_alert_log(game_pk, kind, sent_at)` so each `(game_pk, '30m'|'5m')` pair only fires once.
- Skip games already started / final.

Per game, build the alert payload by querying `mlb_fair_price_events` (last 24h, `game_id = 'mlb_'||gamePk`):
- **Books currently missing**: full configured book list MINUS books seen for this game_id in the last 6h.
- **Per-book latency table**: median lag (`event_time - to_timestamp(feed_ts/1000)` ms), sample count, % stale (>5s). Sort with Hard Rock, FanDuel, DraftKings pinned at top, others below. Format as a fixed-width Markdown code block.
- **Top delay catches (24h, global)**: top 5 events with largest lag where `event_type` indicates a delay catch, with book + game label.

### 2. Telegram send
Use existing telegram connector pattern (admin chat id from `bot_authorized_users` / settings — same path used by other admin-only alerts in this codebase). HTML parse mode, no per-leg property abbreviations.

Message shape:
```
⚾ Pre-game · T-30m
Away @ Home — 7:05 PM ET

Missing books (3): BetMGM, Caesars, ESPNBet

Latency (24h, ms)
Book          med   n    stale%
HardRock      ...   ..   ..%
FanDuel       ...   ..   ..%
DraftKings    ...   ..   ..%
─────
<others ranked>

Top delay catches (24h)
1. 8.4s — HardRock — NYY @ BOS — ML
2. ...
```

### 3. Schedule
Add `pg_cron` job calling the edge function every minute. Insert via `supabase--insert` (carries function URL + anon key, per platform rules — not a migration).

### 4. Dedupe table (migration)
```text
mlb_pregame_alert_log(
  game_pk bigint,
  kind text check (kind in ('30m','5m')),
  sent_at timestamptz default now(),
  primary key (game_pk, kind)
)
```
Plus the required GRANTs + RLS (service_role only; no client read needed).

### 5. Dashboard tile (optional, small)
On `MlbFairPriceDashboard`, add a "Pre-game alerts" status strip showing the last 5 rows of `mlb_pregame_alert_log` so you can confirm sends without leaving the page.

## Open assumptions (will use unless you say otherwise)
- "Hard Rock" book_id = `hardrock` / `hard_rock` — function will accept both.
- Stale threshold = ≥5s (matches the existing delay-catch rule in core memory).
- "Missing for this game" window = no event from that book in the last 6h before scheduled start.
- Admin chat id pulled from the same source the existing admin-only fair-price alerts already use (`telegram_admin_only=true` path in `mlb_fair_price_events`).

## Out of scope
- No customer-facing broadcast.
- No changes to the fair-price gate logic itself.
- No new UI beyond the small status strip.
