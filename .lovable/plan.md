
# Smart Whale Engine — NBA / MLB / Tennis

## Why we're doing this

Audit of the last 21 days of `fanduel_prediction_alerts` (the table feeding Telegram):

```text
sport | signal_type   | side  | count | hit_rate | conf
------+---------------+-------+-------+----------+-----
MLB   | take_it_now   | Over  | 4,014 |   28.5%  |  90
MLB   | take_it_now   | Under | 1,044 |   38.0%  |  89
NBA   | take_it_now   | Over  |    47 |   19.1%  |  90
```

- Only ONE signal type is actually firing (`take_it_now`).
- Every alert is stamped 90 confidence regardless of edge.
- Today's slate: 157 of 159 `batter_walks` alerts are Over, 57 of 57 stolen-base alerts are Over — the whole roster gets flagged.
- `whale_signals` table exists but has **zero rows ever inserted** (the engine doesn't write to it).
- `sharp_line_tracker` already stores opening line, current line, opening prices, current prices per FanDuel prop. We are sitting on real whale data and not using it.

This plan replaces the broken alert with a real whale engine.

---

## Goals

1. Stop the blowout signal types tonight (hard kill + auto-flip to Under).
2. Generate 20–40 graded whale plays per day across NBA / MLB / Tennis based on actual line behavior, not blanket Overs.
3. Use the smartest models (GPT-5 for final ranking, Gemini-2.5-pro for context, Gemini-2.5-flash for high-volume scoring) on the AI Gateway.
4. Make every whale play parlay-ready: feed into `parlay-engine-v2` as `source: 'whale'`, AND emit one daily "Whale Parlay of the Day" (3 legs, cross-sport).

---

## The Plan

### Phase 1 — Blowout kill switch (ships tonight)

1. Hard suppress `signal_type = 'take_it_now'` for `prop_type IN ('batter_walks','batter_stolen_bases')` from broadcast and parlay assembly.
2. Auto-route those props through the existing `accuracy_flip` path to generate Under candidates instead, gated to top-5 per slate by inverse confidence.
3. Add a slate-blowout guard: if more than 20% of starting hitters in a slate get the same Over signal on one prop type, suppress the entire batch and write a `signal_blowout` row to `engine_live_tracker` so we can see it on the dashboard.

### Phase 2 — Smart Whale Engine (the rebuild)

New edge function: `smart-whale-engine`. Runs every 10 minutes during active slates. For every FanDuel prop in `sharp_line_tracker` with an active line, compute four independent whale scores:

1. **Line Gap (open vs current)** — magnitude and direction of `current_line - opening_line` normalized per prop type. Big drift early = sharp money moved it.
2. **Price Steam** — absolute change in over/under prices. A line that holds but prices crash means money is hammering one side without the book wanting to move the number.
3. **Cross-Book Divergence** — FanDuel current_line vs consensus from other bookmakers in `odds_props` (when available). Stale FD line vs moved consensus = sharp opportunity.
4. **Reverse Line Movement (RLM)** — line moves opposite to where the public would naturally push it (uses `bet_percentages` proxy from `metadata.public_pct` already stored on alerts, falling back to "side with worse price got the line move" as the proxy).

Combined into a `whale_score` 0–100. Then graded:

```text
whale_score >= 80  -> Tier S (parlay-grade, daily-whale-parlay eligible)
whale_score >= 65  -> Tier A (parlay-v2 source='whale' high confidence)
whale_score >= 55  -> Tier B (parlay-v2 source='whale' standard)
whale_score <  55  -> dropped
```

Each prop also gets an LLM-written `why_short` (1–2 lines) via `google/gemini-2.5-flash` so the Telegram message reads like the screenshot you sent ("Line moved 0.5 pts in 12 min, FD lagging consensus, RLM detected").

A final Tier-S re-rank pass uses `openai/gpt-5` with reasoning effort `medium` to validate the top ~25 candidates before they hit broadcast (kills false positives from raw math).

Sport-specific tuning baked into config:

- **NBA**: shorter window (line moves in last 90 min weighted 2x), block any prop where minutes are < 28 projected.
- **MLB**: weight pitcher props 1.3x, batter HR/SB/BB get a 0.7x penalty per the audit. Honor existing `Snapback` and `Live Drift` poison-signal blacklist.
- **Tennis**: only ATP/WTA main draw, drop matches inside 30 min of start (data lag), prefer games_won and sets_won over aces/double_faults (cleaner settlement).

Output table: write to `whale_signals` (currently empty) with the four sub-scores already in the schema, plus a new `whale_picks` row per Tier-S/A pick.

### Phase 3 — Parlay assembly (both lanes)

**Lane A — feed into parlay-engine-v2**:
- New leg source `'whale'` added to `ParlaySource` union.
- Whale legs respect the existing same-game concentration cap (0.75 TEMP, min-2-distinct-games).
- Tier S legs get the engine's `FAT_PITCH 1.15x` ranking bonus automatically via existing `SIGNAL_TIER_S` config — just add `'whale_steam'`, `'whale_rlm'`, `'whale_cross_book'` to that set.

**Lane B — Daily Whale Parlay**:
- New edge function `daily-whale-parlay-generator`, runs once at 12:00 PM ET and once at 4:30 PM ET.
- Pulls top Tier-S whale picks from across NBA + MLB + Tennis.
- Builds exactly one 3-leg parlay, hard rule: 3 different games AND minimum 2 different sports (cross-sport mandatory).
- Validation pass with `gpt-5` reasoning: rejects if any two legs have correlation > 0.2 or combined American odds outside +300 to +1200.
- Broadcasts as a separate "🐳 Whale Parlay of the Day" Telegram message and writes to `sharp_ai_parlays` for tracking.

### Phase 4 — UI surfacing

- `WhaleProxyDashboard` already exists at `/whale` — wire it to read from the now-populated `whale_signals` + `whale_picks` instead of the mock generator in `src/lib/whaleUtils.ts`.
- Add a "🐳 Whale Parlay of the Day" card to `/index` showing the cross-sport 3-leg parlay with sub-score breakdown.
- Filters: Sport (NBA / MLB / Tennis / ALL), Tier (S / A+S / All), Time window (next 2h / next 6h / today).

### Phase 5 — Calibration loop

- Extend `calibrate-sharp-signals` to also score whale picks: hourly job that updates `whale_signals.was_correct` after settlement.
- Weekly job retunes the four sub-score weights using last-30-days hit rate per sport (Bayesian smoothing, min 30 samples per sport before adjusting).

---

## Technical details

**New/changed edge functions**:
- `smart-whale-engine` (new) — runs every 10 min, populates `whale_signals` + `whale_picks`.
- `daily-whale-parlay-generator` (new) — 12:00 + 16:30 ET.
- `signal-alert-engine` (edit) — Phase 1 kill switch + slate blowout guard.
- `signal-alert-telegram` (edit) — render whale picks with the open/current/RLM bullet style from your screenshot.
- `parlay-engine-v2` (edit, additive) — accept `'whale'` source, add whale signal types to `SIGNAL_TIER_S`.
- `calibrate-sharp-signals` (edit) — settle whale picks + retune weights.

**Database**:
- New table `whale_picks` (player, sport, prop_type, side, current_line, whale_score, tier, sub_scores jsonb, why_short, expires_at, settled, was_correct).
- Add `source` enum value `'whale'` wherever ParlaySource lives.
- RLS: public read, service-role insert (mirrors `whale_signals`).

**AI Gateway models**:
- `google/gemini-2.5-flash` — per-prop `why_short` generation (high volume, cheap).
- `google/gemini-2.5-pro` — sport-context enrichment (injuries, weather for MLB, surface for tennis).
- `openai/gpt-5` reasoning effort `medium` — final Tier-S validation pass and daily whale parlay correlation check.

**Frontend**:
- Update `src/hooks/useCustomerWhaleSignals.ts` to consume real `whale_picks`.
- New `DailyWhaleParlayCard` on `/index`.
- Delete the mock generator path in `src/lib/whaleUtils.ts` once live data is flowing (keep types).

**Memory updates** after ship:
- New mem note: smart-whale-engine sub-score weights and tier thresholds.
- Update poison-signal-blacklist mem to include the `batter_walks Over` + `batter_stolen_bases Over` blanket suppression.

**Testing** (per project rule: 5 independent tests minimum):
1. Backfill last 7 days through smart-whale-engine and measure tier hit rates vs the 28% baseline.
2. Tonight's KC/LAA + ATH/LAA slate — verify blowout guard suppresses the 40 walks alerts.
3. Cross-book divergence smoke test with a known stale FD line.
4. Daily Whale Parlay generator dry-run for today's slate, manually verify cross-sport rule.
5. Settlement loop: pick 10 whale picks from yesterday, verify `was_correct` populates correctly.

---

## What I am NOT touching

- The existing PVS, Sharp, Hit Rate, Sweet Spot engines — they keep running unchanged.
- Same-game concentration rules, hedge tracker, take-it-now-settler — out of scope.
- No new third-party data vendor. Everything reuses `sharp_line_tracker`, `odds_props`, and FanDuel data we already ingest.
