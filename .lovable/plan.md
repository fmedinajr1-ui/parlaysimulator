

## Quality-Gated Regeneration Loop — "Keep Rolling Until 60%"

### What This Does

Creates an automatic regeneration system that generates parlays up to 3 times before 3PM ET. After games settle the next day, it checks if the 60% hit rate target was met — if yes, the threshold stays; if not, it adjusts for the next cycle.

### How It Works

```text
Day-of (before 3PM ET):

  10:00 ET — Attempt 1: Normal generation (standard thresholds)
     |— Score batch projected hit rate
     |— If >= 60%: DONE, distribute parlays
     |— If < 60%: Void batch
     |
  11:30 ET — Attempt 2: Tighter filters (minHitRate +5%, coherence +5)
     |— Score batch projected hit rate
     |— If >= 60%: DONE, distribute parlays
     |— If < 60%: Void batch
     |
  13:00 ET — Attempt 3: Elite filters (minHitRate +10%, coherence +10)
     |— Keep best batch regardless
     |— Distribute parlays + Telegram report

Next Day (after settlement):

  Settlement runs → check actual hit rate
     |— If >= 60%: Keep current threshold (60%)
     |— If < 60%: Log to adaptive tracker, adjust weights
```

### Changes

**New File: `supabase/functions/bot-quality-regen-loop/index.ts`**

The orchestrator function that manages the regeneration loop:

- Accepts `target_hit_rate` (default: 60) and `max_attempts` (default: 3)
- Enforces a hard deadline of **3:00 PM ET** — no generation after this time regardless of attempt count
- On each attempt:
  - Calls `bot-generate-daily-parlays` with a `regen_boost` parameter (0, 1, or 2)
  - Queries execution-tier parlays generated for today
  - Calculates batch average projected hit rate from leg-level confidence scores
  - If below target: voids today's pending parlays and increments attempt
  - Tracks the best-scoring attempt across all rounds
- After all attempts or hitting the deadline, keeps the best batch
- Sends Telegram summary via `bot-send-telegram` with a `quality_regen_report` message type
- Logs each attempt to `bot_activity_log` with `event_type: 'quality_regen'`

**Modified File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

- Parse `regen_boost` (0, 1, or 2) from the request body
- When `regen_boost = 1`: increase all tier `minHitRate` by +5 and coherence gates by +5
- When `regen_boost = 2`: increase all tier `minHitRate` by +10 and coherence gates by +10
- This progressively filters out weaker picks, keeping only the highest-conviction legs
- Fully backward-compatible: defaults to `regen_boost = 0` when not provided

**Modified File: `supabase/functions/data-pipeline-orchestrator/index.ts`**

- Replace the direct call to `bot-generate-daily-parlays` in Phase 3 with a call to `bot-quality-regen-loop`
- Keep `bot-force-fresh-parlays` after the loop (adds mispriced conviction parlays on top)
- Keep `bot-review-and-optimize` after both

**Modified File: `supabase/functions/bot-settle-and-learn/index.ts`**

- After settling today's parlays, calculate the **actual hit rate** for the day's execution-tier parlays
- Compare against the 60% target
- Log the result to `bot_activity_log` with `event_type: 'hit_rate_evaluation'`
- If actual hit rate >= 60%: log success, threshold stays at 60%
- If actual hit rate < 60%: log the gap, send a Telegram alert with the shortfall and trigger `calibrate-bot-weights` for next-day adjustment

**Modified File: `supabase/functions/bot-send-telegram/index.ts`**

- Add `quality_regen_report` to the notification type list
- Format shows: number of attempts, projected hit rate per attempt, which attempt was kept, time remaining before the 3PM deadline
- Add `hit_rate_evaluation` message: shows actual vs target hit rate after settlement, whether threshold is maintained or adjustment is needed

**Config: `supabase/config.toml`**

- Add `[functions.bot-quality-regen-loop]` with `verify_jwt = false`

### The 3PM ET Deadline

The loop checks `new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })` before each attempt. If the current ET hour is >= 15 (3PM), it stops immediately and keeps the best batch so far. This ensures all parlays are distributed well before tip-off.

### Next-Day Adaptive Threshold

The settlement engine already runs daily. After it processes outcomes, a new step checks:
- Count execution-tier parlays that won vs total settled
- If win rate >= 60%: threshold confirmed, no changes
- If win rate < 60%: the system logs the shortfall and triggers weight recalibration, which will naturally tighten the next day's generation quality

This is NOT a moving target — the 60% minimum stays fixed. What changes is the underlying model weights and sweet spot calibration to help the engine actually hit that target consistently.

### Technical Details

**Projected Hit Rate Calculation:** For each execution-tier parlay, average the `hit_rate_l10` (last-10-game hit rate) across all legs. This uses historical sweet spot performance as a forward-looking quality metric.

**Voiding Between Attempts:** Uses `UPDATE bot_daily_parlays SET outcome = 'void', lesson_learned = 'quality_regen_attempt_N' WHERE parlay_date = today AND outcome = 'pending'` to clear the slate before regenerating.

**Safety:** Maximum 3 attempts hard-coded. 3PM ET deadline hard-coded. Each attempt logged individually. If generator produces 0 parlays on any attempt, that attempt is skipped.

