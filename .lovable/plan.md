

## Current State

Right now the system:
1. **Captures the line at alert time** (`line_at_alert`, `drift_pct_at_alert`, `alert_sent_at`) when a "Take It Now" fires
2. **Counts post-alert snapshots** (`post_alert_snapshots`) but only at verification time (after the game)
3. **Detects traps retroactively** by comparing the closing line to the alert-time line

**What's missing:** There is no **real-time post-alert monitoring** — the system fires a signal, then doesn't look at that line again until the game ends. If FanDuel reverses the line 30 minutes later, we find out after the fact. We never send a follow-up alert saying "line reversed — recommendation changed."

---

## Plan: Post-Alert Line Tracker + Live Recommendation Updates

### 1. Add tracking columns to `fanduel_prediction_accuracy`
- `line_changes_after_alert` (integer) — count of distinct line movements post-alert
- `line_trajectory` (jsonb) — array of `{line, time, delta_from_alert}` snapshots captured after the signal
- `recommendation_status` (text) — `ACTIVE` | `REVERSED` | `UPGRADED` | `DEAD`
- `recommendation_updated_at` (timestamptz)

### 2. Create new edge function: `post-alert-line-monitor`
Runs on a 5-minute cron (same as the scanner). For each **unsettled** "Take It Now" prediction:
- Query `fanduel_line_timeline` for all snapshots after `alert_sent_at`
- Count distinct line changes and build the trajectory array
- Detect three scenarios:
  - **Reversal** (line moved back >40% toward opener): Update recommendation to `REVERSED`, send Telegram warning: "⚠️ LINE REVERSED — original Take It Now on [Player] [Prop] is no longer valid"
  - **Continued drift** (line kept moving in same direction): Update to `UPGRADED` with note that edge grew
  - **Stable** (line hasn't moved significantly): Keep `ACTIVE`
- Persist updates to `fanduel_prediction_accuracy`

### 3. Send live Telegram follow-ups
When a reversal or significant change is detected:
- "🔄 **LINE UPDATE** — [Player] [Prop]: Line moved from [alert_line] → [current_line] ([X] changes in [Y] minutes). **Recommendation: REVERSED/STILL ACTIVE**"
- Include whether the new line creates an edge on the opposite side (flip recommendation)

### 4. Update `fanduel-accuracy-feedback` to use trajectory data
Instead of only comparing alert vs closing, use the full trajectory to classify traps more precisely (e.g., "reversed within 15 min" vs "held for 2 hours then reversed").

---

### Technical Details

- **Cron**: Reuse existing 5-min schedule pattern
- **Query scope**: Only monitor predictions where `was_correct IS NULL` and `signal_type = 'take_it_now'` and `alert_sent_at` is within last 12 hours
- **Flip logic**: If reversal creates ≥10% edge on opposite side AND L10 supports it, send a new "Take It Now" in the opposite direction
- **Dedup**: Don't send more than one reversal alert per prediction

