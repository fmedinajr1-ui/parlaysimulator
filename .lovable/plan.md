

# Bot Self-Awareness Engine + All-Day Winning Schedule

## What You're Asking For

Three connected things:
1. **Self-awareness**: The bot should know its own rules, check them before every decision, and auto-correct when it violates them
2. **All-day schedule**: A structured daily plan that catches winning lines at every window (morning, midday, pre-tip, live, late slate)
3. **Learn from your corrections**: When you fix the bot's logic (like the pitcher K direction fix), it should internalize that rule so it never makes the same mistake again

## What Exists Today (Gaps)

The bot already has learning pieces scattered across 200+ functions:
- `bot-adaptive-intelligence`: recency-weighted category learning
- `bot-evolve-strategies`: weekly strategy evolution
- `calibrate-bot-weights`: weight recalibration from outcomes
- `fanduel-accuracy-feedback`: Bayesian accuracy loop
- `bot-settle-and-learn`: outcome settlement

**What's MISSING:**
- No central **rules registry** — your corrections (pitcher K direction, snapback logic, cross-reference gates) are hard-coded in individual functions with no way for the bot to reference or audit them
- No **intra-day regeneration** — parlays generate once at ~6:30 PM ET; there's no morning, midday, or late-slate generation pass
- No **self-audit loop** — the bot doesn't check its own outputs against its rules before broadcasting
- No **owner directive system** — when you tell the bot "don't do X," there's no table that stores and enforces that across all engines

## Plan

### 1. Create `bot_owner_rules` Table (Migration)

A persistent rules table that every engine reads before making decisions:

```sql
CREATE TABLE public.bot_owner_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text UNIQUE NOT NULL,        -- e.g. 'pitcher_k_snapback_direction'
  rule_description text NOT NULL,       -- human-readable
  rule_logic jsonb NOT NULL,            -- machine-readable conditions
  applies_to text[] NOT NULL,           -- which engines: ['fanduel-behavior-analyzer', 'fanduel-prediction-alerts']
  enforcement text DEFAULT 'hard_block', -- 'hard_block' | 'soft_warn' | 'boost'
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed with rules you've already taught:
INSERT INTO public.bot_owner_rules (rule_key, rule_description, rule_logic, applies_to) VALUES
('pitcher_k_follow_market', 'Pitcher K props follow market direction, not regression', '{"prop_types":["pitcher_strikeouts","pitcher_ks"],"logic":"rising=OVER,dropping=UNDER"}', ARRAY['fanduel-behavior-analyzer','fanduel-prediction-alerts']),
('cross_ref_gate_mandatory', 'All player prop signals must pass L10/L3/matchup cross-reference gate', '{"gate":"cross_reference","applies":"all_player_props","block_if":"l10_contradicts_>10pct_and_hit_rate<30pct"}', ARRAY['fanduel-behavior-analyzer','fanduel-prediction-alerts']),
('no_summary_alt_line_correlation', 'Do not show averaged alt line on multi-player correlation alerts', '{"alert_types":["team_news_shift","correlated_movement"],"suppress":"summary_alt_line"}', ARRAY['fanduel-behavior-analyzer']),
('cascade_needs_direction', 'Cascade alerts must include dominant direction (OVER/UNDER)', '{"signal":"cascade","require":"dominant_direction"}', ARRAY['fanduel-behavior-analyzer']);
```

### 2. Create `bot_daily_schedule` Table (Migration)

Defines the all-day scanning windows:

```sql
CREATE TABLE public.bot_daily_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_name text UNIQUE NOT NULL,
  window_start_et text NOT NULL,       -- e.g. '09:00'
  window_end_et text NOT NULL,
  actions text[] NOT NULL,             -- functions to run
  description text,
  is_active boolean DEFAULT true
);

INSERT INTO public.bot_daily_schedule (window_name, window_start_et, window_end_et, actions, description) VALUES
('early_morning', '08:00', '10:00', ARRAY['whale-odds-scraper','morning-prep-pipeline'], 'Opening lines + overnight movement detection'),
('midday_scan', '11:00', '13:00', ARRAY['fanduel-line-scanner','fanduel-behavior-analyzer','fanduel-prediction-alerts','generate-prediction-parlays'], 'Midday line movement + early prediction parlays'),
('pre_tip_generation', '16:00', '18:30', ARRAY['refresh-l10-and-rebuild'], 'Full pipeline: L10 refresh + parlay generation + DNA audit'),
('live_monitoring', '19:00', '22:00', ARRAY['fanduel-line-scanner','fanduel-behavior-analyzer','hedge-live-telegram-tracker'], 'Live game scanning + hedge alerts'),
('late_slate', '22:00', '00:00', ARRAY['fanduel-line-scanner','fanduel-prediction-alerts','generate-prediction-parlays'], 'West coast / late games — fresh prediction pairs'),
('overnight_settle', '01:00', '06:00', ARRAY['bot-settle-and-learn','fanduel-accuracy-feedback','calibrate-bot-weights'], 'Settle outcomes + learn + recalibrate');
```

### 3. Create `bot-self-audit` Edge Function

A new function that runs after every generation/alert cycle. It:
- Loads all active rules from `bot_owner_rules`
- Checks recent outputs (last 30 min of `fanduel_prediction_accuracy`, `bot_daily_parlays`, `engine_live_tracker`) against rules
- Flags violations and suppresses bad picks before Telegram broadcast
- Logs audit results to a new `bot_audit_log` table
- Sends a Telegram summary of any violations caught

```
bot_audit_log table:
  id, audit_time, rule_key, violation_description, action_taken (blocked/warned/passed), 
  affected_record_id, affected_table
```

### 4. Create `bot-intraday-orchestrator` Edge Function

A single function triggered by cron every 30 minutes that:
- Reads `bot_daily_schedule` to determine the current window
- Runs the appropriate actions for that window
- Calls `bot-self-audit` after each action batch
- Sends window-transition Telegram summaries ("Entering pre-tip window — running full pipeline")
- Tracks which windows have completed today in `bot_schedule_runs`

This replaces the need for multiple separate cron jobs.

### 5. Wire Self-Audit into Existing Engines

Add a rules-check hook to `fanduel-behavior-analyzer` and `fanduel-prediction-alerts`:
- At startup, load active rules from `bot_owner_rules` where `applies_to` includes the current function name
- Before broadcasting any alert, validate against loaded rules
- If a rule is violated, block the alert and log to `bot_audit_log`

This is lightweight — a single query at function start + a filter loop before Telegram dispatch.

### 6. Owner Directive via Telegram (Future Enhancement)

Allow you to add rules via Telegram commands like:
```
/rule add "never recommend UNDER on pitcher Ks when line is rising"
```
This would parse and insert into `bot_owner_rules`. Marked as future — the table and audit engine come first.

## Technical Details

**New tables**: `bot_owner_rules`, `bot_daily_schedule`, `bot_audit_log`, `bot_schedule_runs`
**New edge functions**: `bot-self-audit`, `bot-intraday-orchestrator`
**Modified edge functions**: `fanduel-behavior-analyzer`, `fanduel-prediction-alerts` (add rules-check hook)
**New cron**: Single 30-minute cron calling `bot-intraday-orchestrator`

## What This Gets You

- Every correction you make becomes a permanent rule the bot checks before acting
- The bot runs all day, not just once at 6:30 PM — catching morning steams, midday movement, and late-slate value
- Self-audit catches violations before they reach Telegram, so you stop seeing broken alerts
- The schedule table is editable — you can adjust windows and actions without code changes

