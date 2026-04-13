

# Today's Alert Status + Reduce Alert Noise

## What the recent changes ARE doing (confirmed working)

1. **L10 avg gate** — Active. Logs show: `L10 avg block: Adolis Garcia Under — L10 avg 0.10 outside [0.25, 0.7]`
2. **Blocked players** — Active. Denzel Clarke blocked (no signals from him today)
3. **Perfect Line tightened thresholds** — Active. 0 perfect_line alerts generated today (thresholds may be too tight for today's slate, but they are enforced)

## What's broken: massive alert flooding

| Signal Type | Alerts Today | Problem |
|---|---|---|
| cascade | 247 | Same 2 games repeating every 5 min — daily cap doesn't work for TEAM CASCADE names |
| snapback_candidate | 113 | Juan Brito: 63 alerts, Nick Allen: 25, Edouard Julien: 25 — no daily cap at all |
| price_drift | 10 | Acceptable |

### Root causes

1. **Cascade daily cap broken** — The cap checks `player_name` in the DB, but cascade alerts use `"TEAM CASCADE (player1, player2, ...)"` with players in random order each run. The names never match, so the cap never fires.

2. **Snapback has no daily cap** — The daily cap code only lives in `hrb-mlb-rbi-analyzer`. The `fanduel-behavior-analyzer` (which generates snapback_candidate) has no per-player cap at all.

3. **Snapback is a known poison signal** — Per system memory, snapback has a 0-17% historical win rate and is formally blacklisted from parlays. Yet it's still generating 113 alerts/day and spamming Telegram.

## Plan: 4 changes to reduce noise

### 1. Fix cascade daily cap in `hrb-mlb-rbi-analyzer` (~line 449)
Instead of matching on `player_name` (which varies for TEAM CASCADE), match on `event_id + signal_type` combo. If the same event already has 3+ cascade alerts today, skip it.

### 2. Block snapback_candidate from generating alerts in `fanduel-behavior-analyzer`
Since snapback is a poison signal (0-17% win rate), stop inserting `snapback_candidate` rows into `fanduel_prediction_alerts` entirely. Keep the pattern detection for internal analytics but don't create alerts or send Telegram messages.

### 3. Add cross-run dedup to `hrb-mlb-rbi-analyzer` insert logic
Before inserting, check if the same `event_id + signal_type + prediction` combination was already inserted in the last 30 minutes. Skip if so. This prevents the every-5-minute cascade duplication.

### 4. Add cross-run dedup to `fanduel-behavior-analyzer` for any remaining signal types
Same 30-minute dedup window for `price_drift` signals to prevent accumulation.

## Expected impact
- Cascade alerts: 247 → ~6-10/day (one per unique game event)
- Snapback alerts: 113 → 0 (blocked as poison signal)
- Price drift: stays at ~10 (add dedup guard for safety)
- Total daily noise: ~370 → ~15-20 alerts

