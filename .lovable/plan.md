

# Export All Backend Logic

## Scope
245 edge functions, 352 SQL migrations, plus config. No UI code.

## Structure
The export will be a single organized directory at `/mnt/documents/backend-export/` with this layout:

```text
backend-export/
  README.md                    -- Table of contents + architecture overview
  edge-functions/
    <function-name>/index.ts   -- All 245 edge functions (1:1 copy)
  migrations/
    *.sql                      -- All 352 migrations in order
  config/
    config.toml                -- Supabase config
  PIPELINE_FLOW.md             -- Documents the pipeline orchestration
  SIGNAL_CLASSIFICATION.md     -- Documents signal types and classification logic
```

## What Each File Contains

### README.md
- Lists all edge functions grouped by category (pipeline orchestrators, signal engines, settlement, parlays, data ingestion, scrapers, telegram, verification)
- Quick reference of key tables and RPC functions

### PIPELINE_FLOW.md
- Morning Prep Pipeline (10 AM ET) step-by-step
- Data Pipeline Orchestrator (11 AM / 6:30 PM / 7:30 PM ET) phases
- Refresh & Rebuild flow
- Cron schedule summary

### SIGNAL_CLASSIFICATION.md
- Signal types: cascade, snapback, velocity_spike, price_drift, correlated_movement, team_news_shift, gold_tier1/tier2
- Classification thresholds and directional rules
- Settlement logic per signal type (CLV vs outcome-based)
- Accuracy gating rules (60%+ for parlays, matchup cross-reference gates)

## Implementation
1. Copy all edge function `index.ts` files to the export directory
2. Copy all migration SQL files
3. Copy `supabase/config.toml`
4. Generate the 3 markdown docs by reading key orchestrator functions and summarizing the logic
5. Package as a zip file for download

## Output
- `/mnt/documents/backend-export.zip` — single downloadable archive

