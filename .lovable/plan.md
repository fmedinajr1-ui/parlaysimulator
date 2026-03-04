

## Plan: Clear Today's Parlays & Regenerate with New Protocols

### Step 1: Void All Existing Parlays for Today
- Update all `bot_daily_parlays` rows where `parlay_date = today` and `outcome = 'pending'` to `outcome = 'void'` with `lesson_learned = 'cleared_for_protocol_upgrade'`
- This clears the slate for the new generation

### Step 2: Regenerate via `bot-generate-daily-parlays`
- Call with `source: 'protocol_upgrade_v2'` to trigger the updated engine with:
  - Shootout stack capped at 1/day (was 12 today)
  - Double-confirmed conviction boosted to 13 profiles
  - 80%+ L10 hit rate gate for execution tier
  - Multi-leg role-stacked builder (5-leg + 8-leg tickets)

### Step 3: Run Curated Pipeline
- Call `bot-curated-pipeline` to run the automated manual-style curation:
  - Defense rank filtering (rank 20-30 targets)
  - Multi-engine consensus (2+ engines required)
  - 65%+ L10 hit rate gate
  - Builds 3/5/8/13-leg tickets with SAFE/BALANCED/GREAT_ODDS roles
  - Auto-broadcasts to all customers via Telegram

### Step 4: Run Quality Regen Loop
- Call `bot-quality-regen-loop` with `skip_void: true` (additive) to quality-gate the output
- Adaptive target band (baseline + 1%, clamped 33-36%)

### Execution Order
1. Void existing → DB update
2. `bot-generate-daily-parlays` → regenerate base parlays
3. `bot-curated-pipeline` → curated multi-engine tickets
4. `bot-quality-regen-loop` (skip_void: true) → quality gate

### No Code Changes Needed
All protocols are already deployed in the edge functions from the previous implementation. This is purely an execution task — void old data and invoke the 3 functions in sequence.

