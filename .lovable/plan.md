

## Phase C: Upgrade engine to v2.5 + ship parlays to @parlayiqbot

Two coordinated pieces, in one rollout:

1. **Engine upgrade** — bring `parlay-engine-v2` from v2.1 to v2.5 (sweep presets, correlation model, pluggable Kelly sizing).
2. **Telegram broadcast** — when a slate is generated, post each parlay to your `@parlayiqbot` chat via a new `parlay-engine-v2-broadcast` function.

No cron yet. You invoke it. Cron + settlement come later.

---

### 1. Engine upgrade (v2.1 → v2.5)

All edits stay inside `supabase/functions/_shared/parlay-engine-v2/` so every consumer (generator, backtest) gets the upgrade for free.

**`config.ts` additions**
- `V2_3_BALANCED` preset: `{ MIN_LEG_CONFIDENCE: 0.65, MIN_PARLAY_ODDS: 500 }` — 174% backtest ROI, ~7 parlays/day.
- `V2_3_MAX_ROI` preset: `{ MIN_LEG_CONFIDENCE: 0.75, MIN_PARLAY_ODDS: 500 }` — 206% backtest ROI, ~5 parlays/day.
- `STAKE_SIZING_MODE: "flat" | "kelly_lite" | "fractional_kelly"` (default `"kelly_lite"` — preserves current behavior).
- `KELLY_FRACTION = 0.25`.
- Remove `BIG_ASSIST_OVER` from `SIGNAL_BLACKLIST` (per SPEC §2 — was reverted in v2.1, our port still has it). Per `mem://constraints/testing-policy` and `STRATEGY.md §8`, this is the only signal that's wrong today; THREES stays.

**New file `kelly.ts`** — three sizers behind one `getSizer(mode)` interface. Engine calls the active sizer per parlay; strategies stay untouched.

**New file `correlation.ts`** — port of `correlation.py`:
- `CorrelationModel` (pair-lift map keyed by `(prop_type, side) × (prop_type, side)`, same-game scope).
- `fitCorrelationModel(legs, minPairCount=30)` — builds from historical legs (driven from `bot_daily_parlays.legs` jsonb).
- `adjustedCombinedProbability(parlay, model)` and `warningsFor(parlay, model, negThreshold=0.90)`.

**`generator.ts` changes**
- Constructor accepts optional `{ correlation_model, reject_negative_correlation, config_override }`.
- Each accepted parlay gets `adjusted_combined_probability` and `correlation_warnings` populated when a model is passed.
- When `reject_negative_correlation = true`, parlays with any warning are dropped and counted in `report.rejection_reasons['parlay:negative_correlation']`.
- Stake calculation routed through the new sizer.

**`models.ts`** — add the two new optional fields to `Parlay`. Default `null` / `[]` so older callers behave identically.

**Backward compatibility:** every new field is optional, every new config knob has a default that matches today. The existing `parlay-engine-v2` and `parlay-engine-v2-backtest` functions keep working without code changes.

**Tests** (per the 5-test rule):
1. `getSizer("flat")` returns 1.0 unit regardless of confidence.
2. `getSizer("fractional_kelly")` on a +EV parlay (p=0.30, decimal=5.0) returns positive stake capped at `2 × tier_base`.
3. Default mode `"kelly_lite"` produces identical stakes to today (regression).
4. `fitCorrelationModel` on a synthetic set with 60 `Rebounds OVER × Rebounds OVER` pairs produces lift < 0.90.
5. `ParlayEngine({ reject_negative_correlation: true })` drops a parlay containing two same-game `Rebounds OVER` legs and logs `"parlay:negative_correlation"`.

---

### 2. Telegram broadcast — `parlay-engine-v2-broadcast`

A new edge function. **Generation and broadcast are still decoupled** (per `generator-template/index.ts` rule: "A generator's job is to PRODUCE PICKS, not send messages"). The broadcast function reads from `bot_daily_parlays` and posts to Telegram.

**Why a separate function**: the existing `parlay-engine-v2` writes to `bot_daily_parlays` and returns the slate. The broadcast is a follow-up step you can invoke independently. This matches every other Telegram sender in the codebase (`fetch-hardrock-longshots`, `ai-research-agent`).

**Endpoint**
```
POST /parlay-engine-v2-broadcast
body: {
  date?: "YYYY-MM-DD",                // default = today (ET)
  parlay_ids?: string[],              // optional: only these
  preset?: "v2.2" | "v2.3-balanced" | "v2.3-max-ROI" | "live",
  generate_first?: boolean,           // if true, calls parlay-engine-v2 inline first
  dry_run?: boolean,                  // build the messages but don't send
  chat_id?: string,                   // default = TELEGRAM_CHAT_ID env
}
```

**Flow**
1. If `generate_first = true` → invoke `parlay-engine-v2` (with the chosen preset wired through as `config_override`) to populate `bot_daily_parlays` for today.
2. Pull parlays for `date` from `bot_daily_parlays` (filter by `parlay_ids` if given). Skip ones already broadcast (see step 5).
3. For each parlay, build a Telegram message respecting `mem://telegram/communication-style` (narrative, no abbreviations) and `mem://telegram/ui-standardization` (full prop names — "Points" not "PTS"):

```
🎯 ParlayIQ — mispriced_edge (CORE)
3 legs · +687 · 1.33u · EV +2.78u

1. Luka Doncic — Points OVER 28.5 (-115)
   Volume scorer · conf 0.78 · proj 31.2

2. ...

Why this hits: NBA whitelist alignment, fat-pitch odds band, 0.76 avg confidence.
⚠️ Correlation note: Rebounds OVER × Rebounds OVER same-game (lift 0.80x) — heads up.
```

The correlation note line only appears when `correlation_warnings` is non-empty.

4. Post to Telegram via the existing pattern (matches `stripe-webhook` / `fetch-hardrock-longshots`):
   ```ts
   await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true })
   });
   ```
   Using existing `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` env vars (already set, used by 3 other functions). No new secrets.

5. **Dedup**: insert one row per (parlay_id, chat_id) into a small new table `bot_parlay_broadcasts` so re-running on the same day doesn't double-post:
   ```sql
   CREATE TABLE bot_parlay_broadcasts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     parlay_id uuid NOT NULL REFERENCES bot_daily_parlays(id) ON DELETE CASCADE,
     chat_id text NOT NULL,
     sent_at timestamptz NOT NULL DEFAULT now(),
     telegram_message_id bigint,
     UNIQUE (parlay_id, chat_id)
   );
   ALTER TABLE bot_parlay_broadcasts ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "service role manages broadcasts" ON bot_parlay_broadcasts
     FOR ALL USING (true) WITH CHECK (true);
   ```

6. Return `{ generated, sent, skipped_duplicates, errors[] }`.

**Telegram safety**
- Sequential sends with a 1.2s sleep between messages to avoid the 30 msg/sec global rate limit.
- HTML `parse_mode`; if a message fails parsing, retry once as plain text (matches `ai-research-agent` pattern).
- Per `mem://telegram/authorized-accounts`, default broadcast goes to the configured `TELEGRAM_CHAT_ID` (admin Destiny_0711); `chat_id` override lets you target other chats later.

**Tests** (5):
1. Message builder produces a string with full prop name, line, odds, stake.
2. Correlation warning appears only when `correlation_warnings.length > 0`.
3. Dedup: second invocation for same `(parlay_id, chat_id)` returns `skipped_duplicates += 1` and does not POST.
4. `dry_run = true` builds messages but never calls Telegram (mocked fetch counted = 0).
5. Missing `TELEGRAM_BOT_TOKEN` returns a clean 200 with `errors: ["telegram_not_configured"]` rather than throwing (so a slate generation followed by a broadcast attempt doesn't crash on a fresh environment).

---

### How you'd use it

```ts
// One-shot: generate today's slate using v2.3-balanced and broadcast immediately
supabase.functions.invoke('parlay-engine-v2-broadcast', {
  body: {
    generate_first: true,
    preset: 'v2.3-balanced',
    dry_run: false,
  },
});
```

```ts
// Just rebroadcast 3 specific parlays from today
supabase.functions.invoke('parlay-engine-v2-broadcast', {
  body: { parlay_ids: ['…','…','…'], dry_run: false },
});
```

---

### What this does NOT do

- No cron (manual invoke only — Phase D)
- No settlement / outcome tracking (Phase E)
- No replies / inbound Telegram (`/parlays` command stays as-is in existing bot)
- No frontend UI to trigger it (you can wire a button in a later micro-step)
- No new Telegram bot — uses your existing `@parlayiqbot` token

### Sequence

1. Migration: create `bot_parlay_broadcasts`.
2. Engine upgrade in `_shared/parlay-engine-v2/` (config, kelly, correlation, generator, models) + 5 tests.
3. Build `parlay-engine-v2-broadcast` edge function + 5 tests.
4. Deploy. You invoke it with `dry_run: true` first to inspect formatted messages, then flip to `dry_run: false`.

