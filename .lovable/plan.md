

# Fix All Broken Pipeline Connections

## The Problem
Your system has **two orchestrators** and **~50 cron jobs**, but a huge number of them are calling functions that **don't exist**. Every time they fire, they silently fail, wasting resources and producing no data. The `data-pipeline-orchestrator` reports "partial" status every single day because most of its steps hit 404s.

## Full Audit Results

### Pipeline 1: `engine-cascade-runner` (MOSTLY HEALTHY)
Runs 4x daily (5am, 9am, 10am, 4pm ET). All 17 steps exist and work **except one**:
- `sync-matchup-history` -- fails every single run (100% failure rate across all recent runs)

### Pipeline 2: `data-pipeline-orchestrator` (CRITICALLY BROKEN)
Runs daily at 8am ET. Calls **24 functions**, but **14 of them don't exist**:

| Called Function | Status |
|---|---|
| `unified-props-engine` | GHOST - no code exists |
| `morning-props-scanner` | GHOST |
| `analyze-hitrate-props` | GHOST |
| `predict-upsets` | GHOST |
| `analyze-sharp-line` | GHOST |
| `coach-tendencies-engine` | GHOST |
| `build-hitrate-parlays` | GHOST |
| `generate-suggestions` | GHOST |
| `verify-unified-outcomes` | GHOST |
| `verify-hitrate-outcomes` | GHOST |
| `verify-upset-outcomes` | GHOST |
| `verify-god-mode-outcomes` | GHOST |
| `verify-coaching-outcomes` | GHOST |
| `ai-learning-engine` | GHOST |
| `daily-fatigue-calculator` | OK |
| `track-odds-movement` | OK |
| `pp-props-scraper` | OK |
| `whale-signal-detector` | OK |
| `verify-sharp-outcomes` | OK |
| `verify-juiced-outcomes` | OK |
| `auto-settle-parlays` | OK |
| `verify-fatigue-outcomes` | OK |
| `calculate-calibration` | OK |
| `recalibrate-sharp-signals` | OK |

### Pipeline 3: Standalone Cron Jobs Calling Ghost Functions
These cron jobs fire on schedule but call functions that don't exist:

| Cron Job | Calls | Schedule |
|---|---|---|
| `unified-props-engine-every-4h` | `unified-props-engine` | Every 4h |
| `morning-props-scan` | `morning-props-scanner` | 11:30 UTC |
| `analyze-hitrate-props-daily` | `analyze-hitrate-props` | 11:30 UTC |
| `build-hitrate-parlays-daily` | `build-hitrate-parlays` | 11:45 UTC |
| `daily-parlay-suggestions` | `daily-suggestions-job` | 9:00 UTC |
| `bot-evolve-strategy-weekly` | `bot-evolve-strategy` (singular -- actual function is `bot-evolve-strategies` plural) | Sundays 8:00 UTC |
| `fanduel-daily-parlay-builder` | `fanduel-daily-parlay-builder` | 19:00 UTC |
| `fanduel-trap-scanner-hourly` | `fanduel-trap-scanner` | Every hour |
| `god-mode-upset-engine-every-6h` | `god-mode-upset-engine` | Every 6h |
| `lock-final-picks` | `lock-final-picks` | Every 30min |
| `median-lock-engine-daily` | `median-lock-engine` | 15:00 UTC |
| `median-lock-verify-outcomes` | `verify-median-lock-outcomes` | 13:00 UTC |
| `median-lock-weekly-backtest` | `median-lock-backtest` | Sundays 11:00 UTC |
| `scan-opening-lines-every-4h` | `scan-opening-lines` | Every 4h |
| `verify-fanduel-trap-outcomes` | `verify-fanduel-trap-outcomes` | Every 4h |
| `verify-god-mode-outcomes-every-4h` | `verify-god-mode-outcomes` | Every 4h |
| `verify-unified-outcomes-every-3h` | `verify-unified-outcomes` | Every 3h |
| `verify-upset-outcomes-hourly` | `verify-upset-outcomes` | Every hour |

### Pipeline 4: `auto-settle-ai-parlays` (PARTIALLY BROKEN)
Calls `ai-learning-engine` which doesn't exist. The settlement itself works, but the learning feedback loop is dead.

### Pipeline 5: `sync-and-verify-all` (HEALTHY)
Calls `nba-stats-fetcher` then `verify-all-engine-outcomes`. Both exist and work.

## The Fix

### Step 1: Rewrite `data-pipeline-orchestrator` to only call real functions
Replace all 14 ghost function calls with their **actual working equivalents** from the codebase:

```text
GHOST FUNCTION              -->  REAL REPLACEMENT
------------------------------------------------------
unified-props-engine        -->  whale-odds-scraper (already scrapes all props every 5min)
morning-props-scanner       -->  REMOVE (whale-odds-scraper covers this)
analyze-hitrate-props       -->  category-props-analyzer (does L10 hit rate analysis)
predict-upsets              -->  REMOVE (no equivalent exists)
analyze-sharp-line          -->  auto-refresh-sharp-tracker (wraps sharp analysis)
coach-tendencies-engine     -->  REMOVE (no equivalent exists)
build-hitrate-parlays       -->  bot-generate-daily-parlays (now has win-rate-first profiles)
generate-suggestions        -->  REMOVE (bot-generate handles this)
verify-unified-outcomes     -->  verify-all-engine-outcomes (covers risk, sharp, heat)
verify-hitrate-outcomes     -->  verify-sweet-spot-outcomes (covers sweet spot picks)
verify-upset-outcomes       -->  REMOVE (no upset table to verify)
verify-god-mode-outcomes    -->  REMOVE (no code exists)
verify-coaching-outcomes    -->  REMOVE (no code exists)
ai-learning-engine          -->  calibrate-bot-weights (existing learning function)
```

### Step 2: Fix the `bot-evolve-strategy` cron name mismatch
The cron calls `bot-evolve-strategy` (singular) but the actual function is `bot-evolve-strategies` (plural). Fix the cron command.

### Step 3: Fix `sync-matchup-history` in the cascade runner
Investigate why it fails every run and either fix it or remove it from the cascade so the runner reports "completed" instead of "partial".

### Step 4: Clean up ~18 dead cron jobs
Remove all cron jobs that call ghost functions. These fire hundreds of times per day with zero effect:
- `unified-props-engine-every-4h`
- `morning-props-scan`
- `analyze-hitrate-props-daily` (redundant -- cascade runner already runs `category-props-analyzer`)
- `build-hitrate-parlays-daily` (redundant -- `bot-generate-parlays-4h` already runs)
- `daily-parlay-suggestions`
- `fanduel-daily-parlay-builder`
- `fanduel-trap-scanner-hourly`
- `god-mode-upset-engine-every-6h`
- `lock-final-picks`
- `median-lock-engine-daily`
- `median-lock-verify-outcomes`
- `median-lock-weekly-backtest`
- `scan-opening-lines-every-4h`
- `verify-fanduel-trap-outcomes`
- `verify-god-mode-outcomes-every-4h`
- `verify-unified-outcomes-every-3h`
- `verify-upset-outcomes-hourly`

### Step 5: Fix `bot-evolve-strategy-weekly` cron
Change it to call `bot-evolve-strategies` (the actual function name).

## Technical Details

### Rewritten `data-pipeline-orchestrator/index.ts`
The new orchestrator will have these phases using only real functions:

**Phase 1 - Data Collection:**
1. `whale-odds-scraper` (props + odds for all sports)
2. `daily-fatigue-calculator` (fatigue scores)
3. `track-odds-movement` (sharp money detection)
4. `pp-props-scraper` (PrizePicks projections)
5. `firecrawl-lineup-scraper` (injury/lineup data)

**Phase 2 - Analysis:**
1. `category-props-analyzer` (L10 hit rates, sweet spots)
2. `auto-refresh-sharp-tracker` (sharp line analysis)
3. `whale-signal-detector` (PP vs book consensus)

**Phase 3 - Generation:**
1. `bot-generate-daily-parlays` (win-rate-first parlays with all new profiles)

**Phase 4 - Verification:**
1. `verify-all-engine-outcomes` (risk, sharp, heat parlays)
2. `verify-sharp-outcomes` (sharp money outcomes)
3. `verify-juiced-outcomes` (juiced props)
4. `auto-settle-parlays` (bot parlays)
5. `verify-fatigue-outcomes` (fatigue edge)
6. `verify-sweet-spot-outcomes` (sweet spot picks)
7. `verify-best-bets-outcomes` (best bets)

**Phase 5 - Learning:**
1. `calculate-calibration` (calibration factors)
2. `recalibrate-sharp-signals` (sharp signal accuracy)
3. `calibrate-bot-weights` (bot weight updates)

### SQL to clean dead cron jobs
```sql
SELECT cron.unschedule('unified-props-engine-every-4h');
SELECT cron.unschedule('morning-props-scan');
SELECT cron.unschedule('analyze-hitrate-props-daily');
SELECT cron.unschedule('build-hitrate-parlays-daily');
SELECT cron.unschedule('daily-parlay-suggestions');
SELECT cron.unschedule('fanduel-daily-parlay-builder');
SELECT cron.unschedule('fanduel-trap-scanner-hourly');
SELECT cron.unschedule('god-mode-upset-engine-every-6h');
SELECT cron.unschedule('lock-final-picks');
SELECT cron.unschedule('median-lock-engine-daily');
SELECT cron.unschedule('median-lock-verify-outcomes');
SELECT cron.unschedule('median-lock-weekly-backtest');
SELECT cron.unschedule('scan-opening-lines-every-4h');
SELECT cron.unschedule('verify-fanduel-trap-outcomes');
SELECT cron.unschedule('verify-god-mode-outcomes-every-4h');
SELECT cron.unschedule('verify-unified-outcomes-every-3h');
SELECT cron.unschedule('verify-upset-outcomes-hourly');
```

### SQL to fix the name mismatch cron
```sql
SELECT cron.unschedule('bot-evolve-strategy-weekly');
-- Re-create with correct function name: bot-evolve-strategies (plural)
```

## Expected Impact
- `data-pipeline-orchestrator` goes from "partial" every day to "healthy"
- ~18 dead cron jobs stop wasting invocations (hundreds of 404s per day eliminated)
- The learning feedback loop (`calibrate-bot-weights`) actually fires after verification
- `engine-cascade-runner` stops reporting "1 step failed" on every run
- Every pipeline step that fires will now produce real results

