## Problem

Looking at the last 48h of NBA cascade alerts in `fanduel_prediction_alerts`, every single one came back with `verdict_counts: { strong: 0, lean: 0–2, weak: 3–6 }` and empty `group_reasoning.headline_bullets`. That's why you kept seeing "FADE" / "SKIP" recommendations, faded them with the Over, and won — the engine is mis-classifying real Over cascades as WEAK because:

1. **Verdict math punishes missing data.** In `alert-explainer.ts`, `computeVerdict` returns WEAK whenever `aligned_count <= 1`. Any leg missing matchup intel, juice gap, or PVS minutes (very common for NBA props) starts with 2–3 axes as `no_data`, which makes STRONG basically unreachable and pushes everything to WEAK by default.
2. **Form threshold is too strict.** `hit_rate >= 0.6 = aligned`, `<= 0.3 = against`. A player going 5/10 (50% L10) registers as `neutral`, not aligned — even though that's a coin-flip Over with juice + cascade confirmation behind it.
3. **Pace cutoffs are absolute (≥225 / ≤215).** Modern NBA totals routinely sit 218–224, which means almost every game lands `neutral` on the pace axis.
4. **No "model agrees with the side" axis.** We never feed the player's own L10 mean vs. line into the alignment count, so a player whose L10 average is well above the Over line gets no credit.
5. **FADE recommendation fires too easily.** It only requires "all WEAK + half the legs have big juice + 2 cold L10 OR 2 volatile minutes." With the broken WEAK math above, this trips on cascades that are actually live Overs.
6. **`group_reasoning.headline_bullets` is empty** in production because `opponent_team` resolution from `matchup_intelligence` is missing — so the Telegram message has no "Why this side" context, only the misleading verdict and a FADE call.

## Fix

### 1. Recalibrate the alignment thresholds (`supabase/functions/_shared/alert-explainer.ts`)

- **Form axis**: lower the bar so real edges show up.
  - `aligned` when `hit_rate >= 0.55` (was 0.6).
  - `against` when `hit_rate <= 0.25` (was 0.3).
- **Defense axis**: relax the bands.
  - `aligned`: pos_def_rank ≥ 20 for Over, ≤ 13 for Under (was 22 / 10).
  - `against`: pos_def_rank ≤ 12 for Over, ≥ 20 for Under.
- **Pace axis**: switch to a relative band around the slate median (or fall back to ≥220 / ≤213 for NBA). Stop calling everything "neutral."
- **Juice axis**: a positive juice gap on the alerted side should be `aligned` at ≥ +20 (was +30); `neutral` at +5..+19; `against` only when juice flat-out contradicts the side.
- **Add a 6th axis: `model_edge`** — compare the player's L10 mean to the line:
  - Over + `mean - line >= 0.5 * std` → `aligned`. Over + `mean - line <= -0.5 * std` → `against`.
  - Under symmetric.
  This is the single biggest signal we have and it's not currently in the verdict math.

### 2. Rewrite `computeVerdict` so missing data doesn't auto-WEAK

```text
Inputs: aligned, against, neutral, no_data (sum to 6 with the new axis)
known = aligned + against + neutral
STRONG  if aligned >= 3 AND against <= 1
LEAN    if aligned >= 2 AND against <= 1
WEAK    only when against >= 3 OR (known >= 4 AND aligned == 0)
otherwise NEUTRAL (new verdict — "data thin, no fade signal")
```

NEUTRAL legs render as "🟡 NEUTRAL — thin data, follow price" instead of being lumped into WEAK.

### 3. Smarter recommended-action header (`signal-alert-telegram/index.ts`)

Replace the current six-branch logic with:

- **TAIL** — `strong >= 2` OR (`strong + lean >= total - 1` AND `weak == 0`).
- **TAIL small** — `strong >= 1` AND `weak <= 1`.
- **REVIEW (lean tail)** — `lean + neutral >= total - 1` AND `weak <= 1`. New default for thin-data cascades. Message: "Lean *side*, half stake — not enough context to FADE."
- **FADE** — only when **all** of: `weak == total`, ≥⅔ legs flagged `cold_form` AND `model_edge: against`, juice gap ≥ +25 on alerted side, opponent defense aligned against the alerted side. (Today's bar lets juice + 2 cold L10s trigger a fade; we're raising it to require the model itself to disagree with the line.)
- **SKIP** — everything else where verdict mix is mostly WEAK/NEUTRAL with no model agreement on either side.

This is the core change: today the engine fades whenever it's unsure. The new logic only fades when our own L10/defense math actively disagrees with the alerted side.

### 4. Always fill the "Why this side" block

`buildGroupReasoning` currently emits no bullets when `opponent_team` is null on every leg (which is what's happening in prod). Fix:

- Fall back to `event_id` → `events`/`game_description` lookup so `opponent_team` is resolved even when `matchup_intelligence` is missing the row.
- Always emit at least 2 bullets — model-edge summary ("avg L10 +1.8 over line across 4 legs"), juice summary ("book paying +28 on Over"), pace, injuries — pulling from per-player reasoning so the Telegram message always carries context, not just a verdict.

### 5. Add a "Counter-read" line when the engine flips you

When the action is FADE or SKIP, append one line explaining what would change the call:
- "Counter-read: 3/5 players average above the line in L10 — if you trust the form over the price, take *Over* small."

This is the "more context instead of suggesting fade" piece you asked for — the user always sees both sides and can override.

### 6. Backfill audit script

One-off script (`supabase/functions/cascade-verdict-audit/index.ts`) that re-scores yesterday's cascades with the new thresholds and writes the result to a temp table so we can compare old verdict mix vs. new vs. actual settled outcomes from `fanduel_prediction_alerts.outcome`. This validates the tuning before we let it broadcast.

## Files to change

```text
supabase/functions/_shared/alert-explainer.ts        thresholds, new model_edge axis, new computeVerdict, NEUTRAL verdict, fallback opponent lookup
supabase/functions/signal-alert-telegram/index.ts    new action ladder, counter-read line, NEUTRAL badge rendering
supabase/functions/_shared/cascade-sim.ts            handle NEUTRAL legs in the bankroll sim
supabase/functions/cascade-verdict-audit/index.ts    new — backfill comparison
mem/logic/alerts/explainer-contract.md               update verdict definitions + new axis
mem/logic/betting/cascade-miss-by-1-guard.md         note interaction with new thresholds
```

## Tests

Per project rule (5 verifications before deploy):

1. Unit test in `_shared/alert-explainer_test.ts`: confirm STRONG/LEAN/NEUTRAL/WEAK transitions across the 6 axes.
2. Unit test for `model_edge` axis with synthetic L10 + std data.
3. Replay one of yesterday's faded NBA cascades through `cascade-verdict-audit` and confirm the new mix has ≥1 STRONG.
4. Snapshot test on `signal-alert-telegram` output: TAIL, TAIL small, REVIEW, FADE, SKIP messages each render the counter-read line correctly.
5. Backfill audit on the last 7 days of cascade alerts, compare predicted action vs. settled outcome — target: FADE precision improves, REVIEW (lean tail) win-rate ≥ 50%.

## Out of scope

- No changes to which props enter the cascade pool (the miss-by-1 guard stays as is).
- No new scoring weights inside `signal-alert-engine` itself — only the explainer + Telegram layer.
- No UI changes; this is an alert-quality + reasoning fix.
