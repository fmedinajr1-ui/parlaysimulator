## What this builds

A fully automated **Boost Fader** that runs on a cron (no screenshots, no user input). It:

1. Scrapes the FanDuel "Boosts" lobby (the page in your screenshot — "The Hundred", "First Frame Fever", odds-boost cards) using the existing Firecrawl integration.
2. Parses each boost into structured legs: `(player or team, market, line, side, sport, game)`.
3. For every leg, looks up the **real, un-boosted** market in `unified_props` (we already store live FanDuel + DraftKings lines there).
4. Computes the fair probability per leg from L10 game logs / team trends, then derives the edge on the **opposite** side (the fade).
5. Builds the inverted "fade ticket" with combined American odds.
6. Posts the fade ticket to Telegram automatically — every fresh boost gets one alert, deduped so we don't spam the same boost twice.

You stay completely hands-off. Open Telegram → see the fade picks for today's FanDuel boosts.

## How it works (end-to-end)

```text
                 ┌──────────────────────────────────────┐
   Cron (every   │  fanduel-boost-scanner (NEW)         │
   30 min)  ───▶ │  1. Firecrawl FanDuel /boosts page   │
                 │  2. AI parser → structured legs       │
                 │  3. Save to fanduel_boosts table      │
                 └──────────────┬───────────────────────┘
                                │ new boost rows
                                ▼
                 ┌──────────────────────────────────────┐
                 │  fanduel-boost-grader (NEW)          │
                 │  For each new boost:                 │
                 │   • match each leg to unified_props  │
                 │   • pull L10 from *_player_game_logs │
                 │   • compute fade edge per leg        │
                 │   • drop legs with no edge / bad data│
                 │   • build combined fade ticket       │
                 │  Save to fanduel_boost_fades table   │
                 └──────────────┬───────────────────────┘
                                │ ticket ready
                                ▼
                 ┌──────────────────────────────────────┐
                 │  fanduel-boost-telegram (NEW)        │
                 │  Send Telegram message via existing  │
                 │  connector gateway. Dedup by         │
                 │  boost_hash so each boost is sent    │
                 │  exactly once.                       │
                 └──────────────────────────────────────┘
```

The three functions are split so each can be re-run independently when debugging.

## What you'll see in Telegram

```text
🚫 FanDuel Boost Fade — "First Frame Fever" 🔥
Was +1581 → boosted to +1749 ($10 → $184.91)
Our fade: +740 (4-leg UNDER ticket)

Combined fade edge: +18%

1. DET @ CIN — UNDER 0.5 1st-Inning Runs (-150)
   ↳ Last 20 games at this park: 1st-inning runs hit only 38%
2. MIN @ TB — UNDER 0.5 1st-Inning Runs (-140)
   ↳ Both starters L5 inning-1 ERA < 2.00
3. (skipped — LAA @ KC starter ERA too high, no fade edge)
4. PIT @ MIL — UNDER 0.5 1st-Inning Runs (-135)
   ↳ MIL starter has 0 first-inning runs allowed L7
```

If a boost is actually fairly priced (no fade edge on enough legs), the bot says so:

```text
ℹ️ FanDuel Boost "Mammoth Parlay" — looks fair, no clean fade. Skipped.
```

That honesty matters — most boosts are bad, but not all of them.

## Database schema (one migration)

```sql
create table fanduel_boosts (
  id uuid primary key default gen_random_uuid(),
  boost_hash text unique not null,           -- sha256 of (title + legs) for dedup
  title text not null,                       -- "First Frame Fever"
  category text,                             -- "MLB Boosts" | "NBA Boosts" | "The Hundred"
  original_odds integer,                     -- +1581
  boosted_odds integer not null,             -- +1749
  pays_text text,                            -- "$10 pays $184.91"
  legs jsonb not null,                       -- [{sport,market,player_or_team,line,side,game}]
  raw_text text,                             -- original Firecrawl markdown for debugging
  scraped_at timestamptz not null default now(),
  expires_at timestamptz                     -- last game start time
);

create table fanduel_boost_fades (
  id uuid primary key default gen_random_uuid(),
  boost_id uuid not null references fanduel_boosts(id) on delete cascade,
  fade_legs jsonb not null,                  -- selected fade legs with edge/verdict
  skipped_legs jsonb not null,               -- legs we couldn't fade (with reason)
  combined_american_odds integer,
  combined_fade_edge_pct numeric,
  verdict text not null,                     -- "fade" | "skip"
  telegram_sent_at timestamptz,
  created_at timestamptz not null default now()
);
```

Both tables get RLS with admin-only read; no user-facing UI required for v1.

## Functions

### 1. `fanduel-boost-scanner` (cron, every 30 min during prime hours)

- Calls Firecrawl on `https://sportsbook.fanduel.com/promos` and `https://sportsbook.fanduel.com/boosts` (Firecrawl handles the JS rendering — same pattern as `sportsbook-props-scraper`).
- Sends the markdown to Lovable AI (`google/gemini-2.5-flash`) with a tool-call schema that extracts every boost: title, category, pre/post odds, payout text, and an array of legs `{ sport, player_name?, team?, market, line, side, game_description }`.
- Hashes each boost and inserts into `fanduel_boosts` (dedup on `boost_hash`).
- Returns count of new boosts captured.

### 2. `fanduel-boost-grader` (cron, runs 1 min after scanner)

For each `fanduel_boosts` row that has no `fanduel_boost_fades` entry yet:

- For each leg, **flip** the side (boost says OVER → grade UNDER).
- Look up the matching market in `unified_props` (existing player-prop matcher from `ocr-prop-scan` — depunct + last-name fallback). For team/game markets (1st-inning runs, team totals, moneylines) extend the matcher to handle `event_id` + market type.
- Pull L10 from `nba_player_game_logs` / `mlb_player_game_logs` for player props, or use existing `mlb_first_inning_*` / team-trend tables for team-level boosts (we already have first-inning tables — `fetch-hardrock-longshots` uses similar logic).
- Compute fair-vs-implied edge on the fade side, exactly the same math as `ocr-prop-scan` (`americanToImpliedProb`, `fairOver/fairUnder`, threshold 4%).
- Drop legs with `low_l10_sample`, `no_market_data`, or `no_edge`.
- Build the combined American odds from kept fade legs (need at least 2).
- Save the result with `verdict='fade'` (>=2 fade legs) or `verdict='skip'` (otherwise).

### 3. `fanduel-boost-telegram` (cron, runs 2 min after grader)

- Pulls `fanduel_boost_fades` where `telegram_sent_at IS NULL`.
- Renders the message (same gateway pattern used by `telegram-prop-scanner` / `bot-send-telegram`).
- Sends to `TELEGRAM_CHAT_ID` (admin) — later can fan out to subscribers.
- Stamps `telegram_sent_at` so we never double-send.

### 4. Cron wiring (in the same migration)

Three pg_cron jobs using `pg_net` to invoke each function in sequence:

```sql
select cron.schedule('fanduel-boost-scan',     '*/30 9-23 * * *', $$ ... call scanner ... $$);
select cron.schedule('fanduel-boost-grade',    '1,31 9-23 * * *', $$ ... call grader  ... $$);
select cron.schedule('fanduel-boost-telegram', '2,32 9-23 * * *', $$ ... call sender  ... $$);
```

Times are ET-aligned to the existing pipeline (per the project's pipeline-orchestration memory).

## Edge cases handled honestly

- **Boost has no comparable real market** (e.g., novelty SGP with rare combos) → mark each impossible leg `no_market_data`, skip.
- **L10 sample too small** (rookies, just-traded players) → that leg gets `low_l10_sample`, skip — never fade on guesses.
- **Boost is actually fair** → ticket saved with `verdict='skip'` and a one-line "boost looks fair" Telegram note (optional — togglable so it doesn't spam).
- **Same boost re-scraped** → `boost_hash` unique constraint silently no-ops the insert.
- **All-team/no-player boosts** ("Ducks to Win + Mammoth to Win") → match against team moneylines via `fetch-team-moneylines` data; if not gradable, skip.

## Files added

- `supabase/functions/fanduel-boost-scanner/index.ts`
- `supabase/functions/fanduel-boost-grader/index.ts`
- `supabase/functions/fanduel-boost-telegram/index.ts`
- One migration: `fanduel_boosts` + `fanduel_boost_fades` tables, RLS, indexes
- One insert (project-specific cron URLs + anon key, per the telegram polling pattern): three pg_cron jobs

## Files reused (no edits)

- `unified_props` table (existing FanDuel + DK lines)
- `nba_player_game_logs`, `mlb_player_game_logs` (existing L10 source)
- Firecrawl integration (existing `FIRECRAWL_API_KEY`)
- Telegram connector gateway (existing `TELEGRAM_API_KEY` + `LOVABLE_API_KEY`)
- Edge-calc math from `ocr-prop-scan` (will be inlined — small helper, not worth a shared module)

## What's NOT in v1 (to keep scope tight)

- Fan-out to multiple Telegram subscribers (admin chat only first; subscriber broadcast is a 5-min follow-up once the math is trusted).
- A web UI for browsing past boost fades — everything lives in Telegram and the DB.
- DraftKings / Hard Rock boost lobbies — same architecture, different scrape URL, can be added once FanDuel is dialed in.

Approve and I'll build all three functions, the migration, and the cron jobs.
