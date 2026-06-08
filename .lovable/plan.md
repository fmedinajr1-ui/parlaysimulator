## Goal

Remove every Hard Rock Bet code path. Verify NBA alerts against **FanDuel live lines only**. Update the Telegram footer to read **"Lines verified on FanDuel & DraftKings"** (DK is already pulled via The Odds API for line comparison; FD is the gate).

## What gets deleted

### Worker + bridge
- Entire `hardrock-worker/` directory
- `supabase/functions/mlb-hardrock-ml-bridge/` (function + tests)
- `supabase/functions/fetch-hardrock-longshots/`
- `supabase/functions/_shared/hardrock-lines.ts` + `_test.ts`
- pg_cron jobs: `mlb-hardrock-ml-bridge-30s-a` and `-b` (unschedule via `supabase--insert`)

### Secrets to drop
- `HARDROCK_WORKER_URL`, `HARDROCK_WORKER_SECRET`, `HARDROCK_USER`, `HARDROCK_PASS` (via `secrets--delete_secret`)

### Plan / memory cleanup
- `.lovable/plan.md` — remove HR section
- Delete `mem://logic/betting/hardrock-line-gating.md`
- Update `mem://index.md` to drop that entry and the two HRB-specialty references that are now stale (`hrb-rbi-analyzer`, `hrb-specialty-scanners` — keep if they're FD/MLB-only despite the name; verify on read)

## What gets rewritten

### New `_shared/fanduel-lines.ts`
Mirror of the deleted `hardrock-lines.ts` but pulls `sportsbook='fanduel'` from `market_snapshot` (already populated by the existing FanDuel worker + `mlb-live-ml-bridge` pattern) instead of HR. Same exported surface so callers don't change:
- `getLiveLines(sport)` → cached 5 min
- `checkFdLine({event_id, player, prop_type, side, line})` returning `{ok, line, price, reason?}`
- Tolerance `0.5`, max juice `-200` (unchanged)

### `signal-alert-engine`
- Replace every `checkHrbLine` call with `checkFdLine`
- Replace `stats.dropped_no_hrb` → `stats.dropped_no_fd`
- Suppressed-when-empty rule unchanged (FD coverage gap → suppress NBA alerts)
- Inserted `fanduel_prediction_alerts` row uses FD's `line` / `over_price` / `under_price`, `bookmaker='fanduel'`, `metadata.fd_verified=true`, per-leg `fd_line` / `fd_price`

### `signal-alert-telegram`
- Read `metadata.fd_verified` instead of `hrb_verified`
- Footer text → `📘 Lines verified on FanDuel & DraftKings`

### Surface-only edits (search & replace, no logic change)
Files still referencing `hardrockbet` / `hardrock` for display, dropdowns, or odds-source lists:
- `src/components/auth/TelegramOnboarding.tsx`
- `src/components/scout/warroom/HedgeModeTable.tsx`, `HedgeSlideIn.tsx`
- `src/hooks/useLiveOdds.ts`, `useLiveSweetSpotLines.ts`
- `src/lib/bookScannerMarket.ts`
- `src/pages/PropScanner.tsx`
- `supabase/functions/{fetch-batch-odds, fetch-current-odds, mlb-odds-props-sync, mlb-pregame-latency-alert, nba-ladder-challenge, ocr-prop-scan, outrights-sync, sb-unders-daily-report, sportsbook-props-scraper, team-markets-sync, telegram-prop-scanner}/index.ts`

Remove `hardrockbet` from sportsbook arrays/enums/UI labels. Where a single book must be chosen, default to `fanduel`. Keep DraftKings rows everywhere they exist.

### Database
- Leave existing `market_snapshot` rows with `sportsbook='hardrockbet'` in place (historical). New writes stop the moment the bridge cron is unscheduled.
- `mlb_fair_price_events.book_id='hardrockbet'` rows are historical too; `scout-live-edge` will naturally stop picking HR since no fresh snapshots will land.

## Verification (per testing-policy memory — 5 checks)

1. Rewritten `_shared/fanduel-lines_test.ts` — 5 unit tests: cache hit, empty coverage, tolerance pass, tolerance fail, juice cap.
2. `signal-alert-engine` dry-run via `supabase--curl_edge_functions` → confirm `dropped_no_fd` populated, alerts carry `metadata.fd_verified=true`.
3. `grep -ri "hardrock\|hrb_verified\|checkHrbLine" supabase/functions src` returns nothing.
4. `select count(*) from cron.job where jobname like '%hardrock%'` → 0.
5. Telegram test broadcast → footer reads "Lines verified on FanDuel & DraftKings".

## Out of scope

- Backfilling historical HR-tagged rows
- Removing DraftKings (it stays; only HR is dropped)
- Tearing down the FanDuel worker (it's the new gate)
