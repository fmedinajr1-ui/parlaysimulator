## Goal

Add an admin-only page that surfaces the latest crawler and odds-builder runs, with timestamps, fetched market counts, and any errors or missing-data notes.

## Data source

Reuse `cron_job_history` (already populated by every scraper / fetcher / builder). No schema changes needed.

Crawler/odds-builder jobs we'll filter for (substring match on `job_name`):
- `*-scraper` (pp-props, sportsbook-props, whale-odds, ncaab-kenpom, ncaab-referee)
- `*-fetcher` (nba-stats, nba-team-pace, ncaa-baseball, ncaab-team-stats, nfl-stats, nfl-team-defense, nhl-*)
- `fetch-*-injuries` (mlb, nfl, nhl)
- `fanduel-line-scanner`, `fanduel-behavior-analyzer`, `fanduel-trap-scanner`, `fanduel-accuracy-feedback`, `fanduel-prediction-alerts`
- `unified-props-engine`, `lottery-1500-builder`, `verify-unified-outcomes`, `verify-fanduel-trap-outcomes`

A constant array `CRAWLER_JOB_PATTERNS` will drive both filtering and grouping (Scrapers / Stats Fetchers / Injuries / FanDuel / Builders).

## New page: `/admin/crawlers`

Route added in `src/App.tsx`, gated by `useAdminRole`. Linked from `MenuDrawer` admin section (icon: `Radar`) and from the existing Admin Panel page.

### Layout

```text
Header: "Crawler & Odds Builder Runs"  [Refresh] [Auto-refresh 30s toggle]

Summary strip (last 24h):
 [Total runs] [✓ Completed] [⚠ No-data] [✗ Failed] [Avg duration]

Filters row:
 Category dropdown (All / Scrapers / Fetchers / Injuries / FanDuel / Builders)
 Status dropdown (All / completed / failed / no_data / running)
 Job name search input

Group: "Latest run per job" (one row per distinct job_name, newest)
 Table: Job | Category | Last run (relative) | Status | Duration | Markets/Rows fetched | Error/Note

Group: "Recent run history" (paginated, 50 per page)
 Same columns + expandable row showing full result JSON and error_message
```

### "Markets/Rows fetched" extraction

Read from `result` JSON using common keys we already store:
`markets`, `marketsCount`, `rowsFetched`, `inserted`, `updated`, `propsCount`, `gamesProcessed`, `totalFetched`. Show the first numeric one found, else `—`.

### Errors / missing data

- `status='failed'` → red badge + `error_message`.
- `status='no_data'` → amber badge + `error_message` (typically "no games today" style).
- `status='completed'` with `result.markets === 0` or `result.inserted === 0` → amber "0 rows" warning chip.

## Files

- `src/pages/admin/CrawlerRunsPage.tsx` — new page.
- `src/components/admin/CrawlerRunsTable.tsx` — table + row expansion.
- `src/components/admin/CrawlerSummaryStrip.tsx` — 24h stat cards.
- `src/lib/crawlerJobs.ts` — `CRAWLER_JOB_PATTERNS`, category mapping, `extractFetchedCount(result)`.
- `src/App.tsx` — add `/admin/crawlers` route (admin-guarded).
- `src/components/layout/MenuDrawer.tsx` — add "Crawler Runs" item under Admin Tools.

## Data fetching

Two `useQuery` hooks against `cron_job_history`:

1. `latest-per-crawler` — RPC-free: `SELECT *` for jobs in the pattern list ordered by `started_at desc` limit 500, then dedupe client-side keeping newest per `job_name`.
2. `crawler-history` — paginated `SELECT *` filtered by selected category + status + search, ordered by `started_at desc`, range pagination.

Both `refetchInterval: 30_000` when auto-refresh is on.

## Out of scope

- No new tables, no migrations, no edge function changes.
- No edits to existing crawler functions.
- No write actions (manual re-trigger button) in this first cut — `CronJobHistoryPanel` already covers ad-hoc reruns elsewhere; can be added later if you want.
