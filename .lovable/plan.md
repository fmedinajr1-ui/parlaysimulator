

# Telegram Audit + Parlay Generator Overhaul

## What I Found (Audit Summary)

Last 7 days across ALL strategies: **1 win out of 38 settled tickets**, 22 voided (settler couldn't match player/date). The DNA + integrity stack is gating real picks while voids mask real losses.

| Strategy | Tickets | Won | Lost | Void | Pending |
|---|---|---|---|---|---|
| mlb_cascade_parlays | 20 | 1 | 2 | 17 | 0 |
| l3_cross_engine | 6 | 0 | 0 | 3 | 3 |
| bidirectional_bench_under | 8 | 0 | 0 | 4 | 4 |
| mega_lottery_scanner | 4 | 0 | 2 | 0 | 2 |

Root causes:
1. **DNA audit + integrity-check + auto-apply chain** strips/flips legs after generation — picks that pass the model get silently mutated
2. **NBA bidirectional_bench_under** uses fixed $250 stake from `bot_stake_config` even on 80% L10 hit-rate plays that should be tighter
3. **RBI generator** depends on `get_rbi_accuracy_dashboard` RPC requiring 60% WR + 5 settled — with mostly voids, nothing qualifies → empty slate
4. **SB analyzer** produces alerts but no parlay generator wraps them into Over SB tickets
5. **Cross-sport (`l3-cross-engine-parlay`)** filters out MLB from mispriced lines and only ships 1 ticket/day

## Plan — 5 Deliverables

### 1. `telegram-audit-report` (NEW)
Edge function that scans the last 14 days of `bot_daily_parlays` + `straight_bet_tracker` and posts a full audit to Telegram: per-strategy win rate, void rate, stake ROI, signal-type breakdown, kill-filter rejection counts. One-shot diagnostic.

### 2. `generate-rbi-parlays-v2` (NEW — replaces v1 in pipeline call)
- Drop the 60%-WR-on-5-settled gate (broken because settlement data is sparse)
- Pull directly from `mlb_rbi_under_analyzer` outputs + `straight_bet_tracker` cascade signals
- Build 2-leg ($25), 3-leg ($15), 4-leg ($10) UNDER-only tickets
- Skip DNA scoring entirely
- Skip `bot-parlay-integrity-check` and `bot-parlay-auto-apply` post-processing

### 3. `generate-sb-over-parlays` (NEW)
- Reads `fanduel_prediction_alerts` where `signal_type='sb_over_l10'` and tier ELITE/HIGH
- Builds 2-leg ($20) and 3-leg ($10) Over 0.5 SB tickets
- Pitcher slow-delivery + catcher CS% as filter (already in sb-analyzer output metadata)
- No DNA, no integrity gate

### 4. `generate-cross-sport-parlays-v2` (NEW — replaces `l3-cross-engine-parlay`)
- INCLUDES MLB (current version excludes baseball)
- Mixes: 1 NBA Under + 1 MLB Under RBI + 1 SB Over (or HR Over)
- Builds 5 tickets/day at $20 stake each
- Confidence-tier gate only (no DNA, no integrity)

### 5. NBA stake config simplification
- New file `nba-bench-under-generator-v2`: replaces `nba-matchup-daily-broadcast`'s parlay-insert section
- Fixed $10 stake (no more bot_stake_config lookup → no more $250 swings)
- Removes the bidirectional kill-flag that drops legs when defense rank disagrees

## Files to be Removed from Pipeline (kept on disk for reference)
- `analyze-pick-dna` → unhooked from morning-prep
- `score-parlays-dna` → unhooked
- `bot-parlay-integrity-check` → unhooked from generators
- `bot-parlay-smart-check` → unhooked
- `bot-parlay-auto-apply` → unhooked

These functions stay deployed (in case you want them back) but are removed from the orchestration call chain.

## Files to be Edited
- `supabase/functions/morning-prep-pipeline/index.ts` — swap to v2 generators, remove DNA steps
- `supabase/functions/nba-matchup-daily-broadcast/index.ts` — remove `bot_stake_config` lookup, hardcode $10

## Files to be Created
1. `supabase/functions/telegram-audit-report/index.ts`
2. `supabase/functions/generate-rbi-parlays-v2/index.ts`
3. `supabase/functions/generate-sb-over-parlays/index.ts`
4. `supabase/functions/generate-cross-sport-parlays-v2/index.ts`
5. `supabase/functions/nba-bench-under-generator-v2/index.ts`

## Output for You to Review
After implementation, I'll list each new file with a brief description of its inputs, gating logic, and Telegram message format. Then you can run them one-by-one via curl or wait for the next morning-prep cycle.

## What I Need From You
Before building, two quick decisions:

