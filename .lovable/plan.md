

## FanDuel Line Behavior Prediction Engine

### The Core Idea

You're right — if we're trying to **beat** FanDuel's line adjustments, 30 minutes is way too slow. FanDuel typically adjusts lines in **3-7 minute windows** after sharp money hits. To predict where a line is going before FanDuel moves it, we need to:

1. Track lines at **5-minute intervals** (not 30 min or 3x/day)
2. Store a persistent timeline so we can learn FanDuel's **behavioral patterns** (how fast they react, which markets move first, cascade patterns)
3. Build a **prediction layer** that recognizes the early signals of an incoming move and alerts you BEFORE FanDuel finishes adjusting

### What's Broken Right Now

| Component | Current Speed | Problem |
|---|---|---|
| `track-odds-movement` | 3x per day | Misses 95% of intra-day moves |
| `whale-odds-scraper` | Every 30 min | Too slow to catch sharp windows |
| Prop markets tracked | Only PTS + AST | Missing REB, 3s, blocks, steals |
| Games tracked for props | Max 2 | Ignores most of the slate |
| Snapshot retention | Deleted after 24h | Can't learn patterns |
| Sports | NBA only for props | No MLB/NHL prop tracking |

### Telegram Digest — Current State

Telegram alerts fire from multiple functions but they're all **reactive** (reporting what already happened):
- `pregame-scanlines-alert` — 15 min cron, alerts 30 min before tip
- `hedge-live-telegram-tracker` — 15 min cron, in-game status updates
- `bot-send-telegram` — used by diagnostics, integrity, broadcasts
- Various outcome verifiers send results

None of these predict where lines are **going**. They report where lines **went**.

### The Build — 3 Layers

#### Layer 1: High-Frequency FanDuel Scanner (every 5 min)

**New function: `fanduel-line-scanner`**

Replaces the broken 3x/day `track-odds-movement` prop tracking with a dedicated FanDuel-only scanner:
- Runs every **5 minutes** from 10AM to 1AM ET
- Covers NBA, MLB, NHL — all prop markets available on FanDuel
- Stores every snapshot in `fanduel_line_timeline` (retained 30 days, not 24h)
- Tags each snapshot with phase: `morning_open`, `midday`, `pre_tip`, `live`, `closing`
- Filters `bookmakers=fanduel` in API calls to save budget (one book = ~75% fewer API calls)
- Tracks: line value, over/under prices, hours-to-tip, drift from opening

**New table: `fanduel_line_timeline`**
- `sport`, `event_id`, `player_name`, `prop_type`, `line`, `over_price`, `under_price`
- `snapshot_phase`, `snapshot_time`, `hours_to_tip`
- `line_change_from_open`, `price_change_from_open`
- `drift_velocity` (computed: points moved per hour)
- 30-day retention via nightly cleanup

#### Layer 2: FanDuel Behavior Pattern Detector

**New function: `fanduel-behavior-analyzer`** (runs every 15 min)

This is the prediction engine. It reads the timeline and identifies FanDuel's behavioral patterns:

1. **Cascade Detection**: When FanDuel moves one prop market for a player, they often adjust related markets within 5-15 minutes. If Points line drops, Rebounds/Assists lines follow. Detect cascade start and alert before wave completes.

2. **Velocity Alerts**: Track how fast a line is moving (drift_velocity). A line that moved 0.5 points in 10 minutes is about to move again. Alert when velocity exceeds historical norms.

3. **Opening Line Anchor Divergence**: FanDuel tends to snap lines back toward opening if they drift too far without sharp confirmation. Detect overextended lines ripe for snapback.

4. **Cross-Sport Pattern Learning**: Store FanDuel's reaction speed by sport and market type. MLB pitcher Ks move slower than NBA points. Learn the cadence per market.

5. **Sharp Timing Windows**: FanDuel adjusts fastest between 2-4 PM ET (early sharp money) and 30-60 min pre-tip. Lines are stickiest in morning. Learn and exploit the slow windows.

**New table: `fanduel_behavior_patterns`**
- `sport`, `prop_type`, `pattern_type` (cascade, velocity_spike, snapback, etc.)
- `avg_reaction_time_minutes`, `avg_move_size`, `confidence`
- `sample_size`, `last_updated`

#### Layer 3: Predictive Alert Engine + Telegram

**New function: `fanduel-prediction-alerts`** (runs every 5 min during game windows)

Fires Telegram alerts for three signal types:

1. **"LINE ABOUT TO MOVE"** — Cascade detected, velocity spike, or sharp money pattern recognized. Alert includes predicted direction and magnitude.

2. **"TAKE IT NOW"** — Line is at a soft number that historically snaps back. Window to grab value before FanDuel corrects. Includes the over/under recommendation and confidence.

3. **"TRAP WARNING"** — Line moved in a pattern historically associated with traps (sharp reversal, both-sides movement). Don't touch this one.

Telegram format:
```text
PREDICTION ALERT — NBA
Wembanyama PTS OVER 24.5
Line dropped 1.5 pts in 20 min (velocity: 4.5/hr)
FanDuel avg reaction: 12 min remaining
Cascade: AST line not yet adjusted
Action: TAKE OVER NOW
Confidence: 78%
```

#### Self-Correction: Accuracy Feedback Loop

**New function: `fanduel-accuracy-feedback`** (nightly 2AM ET)

- Compares every prediction alert against actual outcomes
- Buckets accuracy by: sport, prop type, signal type, time-to-tip, velocity range
- Auto-adjusts velocity thresholds and cascade timing based on what's actually winning
- Updates `fanduel_behavior_patterns` with fresh reaction times
- Target: start at baseline, improve weekly as data accumulates

**New table: `fanduel_prediction_accuracy`**
- `signal_type`, `sport`, `prop_type`, `prediction`, `actual_outcome`
- `was_correct`, `edge_at_signal`, `time_to_tip_hours`
- Feeds back into behavior analyzer weights

### Updated Cron Schedule

| Function | Frequency | Why |
|---|---|---|
| `fanduel-line-scanner` | Every 5 min | Catch FanDuel moves in real-time |
| `fanduel-behavior-analyzer` | Every 15 min | Pattern detection needs 3+ data points |
| `fanduel-prediction-alerts` | Every 5 min (game hours) | Predictions must be faster than FanDuel |
| `fanduel-accuracy-feedback` | Daily 2AM ET | Nightly self-correction |

### API Budget Impact

Current whale scraper uses ~1,072/2,500 calls per day across multiple books.
FanDuel-only scanning with `&bookmakers=fanduel` reduces per-call cost significantly.
At 5-min intervals for ~12 hours = ~144 calls/day for game lines + ~144 for props = ~288 total new calls.
Well within budget, especially since we're filtering to one book.

### Implementation Order

1. Create 3 new database tables (`fanduel_line_timeline`, `fanduel_behavior_patterns`, `fanduel_prediction_accuracy`)
2. Build `fanduel-line-scanner` — start collecting 5-min data immediately
3. Upgrade `track-odds-movement` — expand from 2 markets to all, remove 2-game cap, increase cron to every 5 min
4. Build `fanduel-behavior-analyzer` — pattern detection layer
5. Build `fanduel-prediction-alerts` — Telegram prediction alerts
6. Build `fanduel-accuracy-feedback` — close the self-correction loop
7. Set up all 4 new cron jobs

### Technical Details

- All functions are edge functions in `supabase/functions/`
- FanDuel-only API calls use `&bookmakers=fanduel` parameter on The Odds API
- Timeline data retained 30 days via nightly `DELETE WHERE snapshot_time < now() - interval '30 days'`
- Behavior patterns table has no TTL — patterns accumulate permanently
- Telegram alerts use existing `bot-send-telegram` infrastructure

