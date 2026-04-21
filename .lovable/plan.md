

## Wipe the entire bot + telegram + pipeline edge function layer (keep all data)

Clean teardown so we can rebuild the Telegram bot and pipeline from a blank slate. **All database tables, historical parlays, learning data, and accuracy stats stay intact.** Only edge functions and cron jobs are deleted.

### What gets deleted

**~165 edge functions** across these groups:

- **Telegram surface** (5): `telegram-webhook`, `telegram-webhook-v1-backup`, `telegram-batch-flusher`, `telegram-audit-report`, `bot-send-telegram`
- **Bot orchestration** (~30): `bot-curated-pipeline`, `bot-intraday-orchestrator`, `bot-slate-status-update`, `bot-daily-diagnostics`, `bot-daily-bankroll-checkin`, `bot-daily-winners`, `bot-evolve-strategies`, `bot-pipeline-doctor`, `bot-pipeline-preflight`, `bot-self-audit`, `bot-review-and-optimize`, `bot-settle-and-learn`, `bot-adaptive-intelligence`, `bot-announce-strategy-update`, `bot-quality-regen-loop`, `bot-parlay-auto-apply`, `bot-parlay-integrity-check`, `bot-parlay-smart-check`, `bot-update-engine-hit-rates`, `bot-daily-diversity-rebalance`, `bot-force-fresh-parlays`, `bot-recent-wins`, `bot-public-stats`, `bot-game-context-analyzer`, `bot-matchup-defense-scanner`, `bot-check-live-props`, `bot-close-miss-analyzer`, `bot-generate-daily-parlays`, `bot-generate-straight-bets`, `bot-insert-longshot-parlay`, `bot-reonboard-existing`
- **Pipeline orchestrators** (5): `morning-prep-pipeline`, `morning-data-refresh`, `data-pipeline-orchestrator`, `engine-cascade-runner`, `orchestrator-daily-narrative`
- **Parlay generators** (~15): `generate-rbi-parlays`, `generate-rbi-parlays-v2`, `generate-cross-sport-parlays-v2`, `generate-sb-over-parlays`, `generate-accuracy-flip-parlays`, `generate-prediction-parlays`, `generate-dd-td-picks`, `generate-lottery-cards`, `generate-matchup-scanner-picks`, `generate-extra-plays-report`, `generate-roasts`, `nba-bench-under-generator-v2`, `mlb-cascade-parlay-generator`, `gold-signal-parlay-engine`, `final-verdict-engine`, `l3-cross-engine-parlay`, `sharp-parlay-builder`, `hedge-parlay-builder`
- **Settlement / verification** (~25): `settlement-orchestrator`, `auto-settle-parlays`, `auto-settle-ai-parlays`, `mlb-rbi-settler`, `mlb-sb-settler`, `mlb-cascade-parlay-settler`, `verify-ai-parlay-settlements`, `verify-all-engine-outcomes`, `verify-best-bets-outcomes`, `verify-elite-parlay-outcomes`, `verify-fatigue-outcomes`, `verify-juiced-outcomes`, `verify-risk-engine-outcomes`, `verify-scout-outcomes`, `verify-sharp-outcomes`, `verify-sweet-spot-outcomes`, `verify-whale-outcomes`, `settle-dd-td`, `settle-hedge-snapshots`, `settle-hedge-tracker`, `recalibrate-accuracy`, `recalibrate-sharp-signals`, `settlement-weight-updater`
- **Analyzers / scanners** (~30): `category-props-analyzer`, `mlb-rbi-under-analyzer`, `mlb-sb-analyzer`, `mlb-batter-analyzer`, `mlb-pitcher-k-analyzer`, `mma-rounds-analyzer`, `tennis-games-analyzer`, `line-sum-mismatch-analyzer`, `line-projection-engine`, `high-conviction-analyzer`, `matchup-intelligence-analyzer`, `hrb-mlb-rbi-analyzer`, `hrb-mlb-rbi-scanner`, `hrb-nrfi-scanner`, `nba-mega-parlay-scanner`, `nhl-prop-sweet-spots-scanner`, `first-inning-hr-scanner`, `perfect-line-scanner`, `double-confirmed-scanner`, `whale-signal-detector`, `whale-odds-scraper`, `fanduel-line-scanner`, `fanduel-prediction-alerts`, `fanduel-accuracy-feedback`, `fanduel-behavior-analyzer`, `signal-classifier`, `pregame-scanlines-alert`, `scanlines-game-markets`, `engine-tracker-sync`, `prop-engine-v2`, `dd-td-pattern-analyzer`, `analyze-pick-dna`, `score-parlays-dna`, `pre-game-leg-verifier`, `detect-mispriced-lines`, `finalize-mispriced-verdicts`, `finalize-line-determination`, `recurring-winners-detector`, `post-alert-line-monitor`, `track-juiced-prop-movement`, `track-odds-movement`
- **Broadcasters / alerts** (~10): `send-parlay-alert`, `send-slate-advisory`, `send-juiced-picks-email`, `send-daily-pick-drip`, `send-hedge-push-notification`, `daily-winners-broadcast`, `broadcast-new-strategies`, `broadcast-sweet-spots`, `nba-matchup-daily-broadcast`, `manual-parlay-broadcast`, `nhl-floor-lock-daily`, `straight-bet-slate`, `daily-fatigue-calculator`, `hedge-live-telegram-tracker`, `parlay-tracker-monitor`, `parlay-tracker-input`
- **`_shared` files used only by the above** (8): `alert-enricher.ts`, `accuracy-lookup.ts`, `alert-context.ts`, `bankroll-curator.ts` (function), `narrative-state.ts`, `onboarding-state-machine.ts`, `parlayfarm-format.ts`, `pick-formatter.ts`, `voice.ts`, `customer-pick-router.ts`, `telegram-client.ts`

### What stays

- **All data** — `bot_daily_parlays` (2,566 rows), `bot_*` tables, `telegram_*` tables, `engine_*` tables, learning state, accuracy history
- **Site-critical functions** — Stripe (`create-bot-checkout`, `create-free-signup`, `create-checkout`, `create-analysis-checkout`, `customer-portal`, `stripe-webhook`, `verify-analysis-payment`, `purchase-scans`, `credit-scan-purchase`, `decrement-pilot-scan`, `increment-scan`, `check-subscription`, `check-device`)
- **Auth / email** — `send-email-verification`, `verify-email-code`, `send-phone-verification`, `verify-phone-code`, `cleanup-phone-verification`, `send-bot-access-email`, `retrieve-bot-password`, `send-transactional-email`, `process-email-queue`, `preview-transactional-email`, `handle-email-suppression`, `handle-email-unsubscribe`, `send-release-notification`, `send-push-notification`
- **Blog / marketing** — `generate-blog-post`, `blog-rss`, `blog-sitemap`, `parlayfarm-sticky-header`
- **Frontend-facing tools** — `extract-parlay`, `grade-slip`, `pick-full-scan`, `find-swap-alternatives`, `fetch-parlay-comparison`, `ai-research-agent`, `analyze-game-footage`, `analyze-live-frame`, `extract-youtube-frames`, `pp-props-scraper`, `firecrawl-lineup-scraper`, `sportsbook-props-scraper`
- **TikTok stack** (entire group, in active use) — all `tiktok-*` functions
- **Data ingestion** kept for now (no harm, can wipe later if you want) — `mlb-data-ingestion`, `mlb-props-sync`, `mma-props-sync`, `tennis-props-sync`, `nba-stats-fetcher`, `nfl-stats-fetcher`, `nhl-stats-fetcher`, `ncaab-*`, `ncaa-baseball-*`, etc.
- **Hedge / scout / pool** kept — `record-hedge-snapshot`, `scout-agent-loop`, `scout-data-projection`, `pool-manager`
- **Telegram secrets** — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, admin chat IDs all preserved

### Cron cleanup

Drop every `cron.job` row whose command invokes a deleted function. From the live job list that's ~50 jobs including: `bot-daily-diagnostics`, `bot-intraday-orchestrator`, `bot-evolve-strategy-weekly`, `bot-settle-and-learn-3x`, `bot-daily-bankroll-checkin`, `bot-review-and-optimize-4h`, `morning-prep-pipeline-daily`, `morning-data-refresh-daily`, `engine-cascade-*` (4 jobs), `daily-data-pipeline-8am-est`, `fanduel-line-scanner-5min`, `fanduel-prediction-alerts-5min`, `fanduel-behavior-analyzer-15min`, `fanduel-accuracy-feedback-2hr`, `hrb-mlb-rbi-analyzer-5min`, `hrb-mlb-rbi-scanner-5min`, `check-live-props`, `parlayfarm-batch-flusher`, `parlay-tracker-monitor-15min`, `daily-winners-broadcast`, `nba-matchup-daily-broadcast`, `daily-straight-bet-slate`, `daily-ladder-challenge`, `daily-ai-research-agent`, `mispriced-lines-*` (2), `finalize-mispriced-verdicts`, `finalize-line-determination-job`, `generate-accuracy-flip-parlays`, `hedge-live-telegram-tracker`, `l3-cross-engine-parlay-daily`, `auto-settle-ai-parlays-daily`, `morning-settle-ai-parlays`, `evening-verify-outcomes-11pm-est`, `midnight-settle-parlays-est`, `nhl-floor-lock-daily`, `daily-defense-ratings-refresh`, `daily-nba-fatigue-calculator`, `daily-verify-fatigue-outcomes`, `recurring-winners-detector` (any), `bankroll-curator-30min`, `orchestrator-daily-narrative-tick`, `accuracy-report-tuesday`.

Done as a single migration: `DELETE FROM cron.job WHERE jobname IN (...)`.

### Frontend impact

The homepage rebuild is unaffected — it doesn't call any of the deleted functions. Some admin/internal pages will break (e.g. `usePipelinePreflight`, `useBotPipeline` UI components in `/dashboard`). Hooks stay; they'll just return empty/stale data until the new pipeline writes to `bot_daily_parlays` again. We can hide the broken admin tiles in a follow-up.

### Execution

1. **Migration** — `DELETE FROM cron.job WHERE jobname IN (...)` for the ~50 affected jobs
2. **Bulk file delete** — remove ~165 `supabase/functions/<name>/` directories + 11 `_shared/*.ts` files
3. **`supabase--delete_edge_functions`** — undeploy the same ~165 function names so they 404 immediately
4. **Verify** — confirm preserved functions (`create-bot-checkout`, `tiktok-*`, blog, auth) still build cleanly
5. **Telegram webhook** — the existing webhook URL will start returning 404 once `telegram-webhook` is undeployed. After rebuild we'll re-register via `setWebhook`. Same `TELEGRAM_BOT_TOKEN` reused.

### After this lands

You'll have a clean `supabase/functions/` directory with only Stripe, auth, blog, TikTok, scout/pool, ingestion, and frontend-facing tools left. Next message you can describe the new bot + pipeline architecture and we'll build it from scratch against the existing data tables.

