
## The problem with what you're seeing

Last 24h in `mlb_fair_price_events`:

- **38 total events** logged
- **0 had `book_id`** populated
- **0 had `book_implied`**
- **0 had `book_last_move_ts`**
- All 38 → `skip` / `no_book_or_suspended` / `WARN`
- `book_snapshot` table: **0 rows in 24h**

That's why the feed reads like wallpaper. It's not catching delays — it's logging "we couldn't even see a book line" 38 times in a row. The lag column will never populate while the upstream book snapshot is empty, so a "Book Latency Leaderboard" built on this data has nothing to rank.

There are two things to fix, and they're separate. This plan only covers the UI redesign you asked about. The empty `book_snapshot` is an upstream/scraper issue I'll flag in the UI but not touch in this plan.

## What the feed becomes: "Delay Catches"

Replace the current dumping-ground table with a feed that only shows things worth looking at.

### Inclusion rule (hard filter)

A row appears **only** if all are true:
- `book_last_move_ts IS NOT NULL` AND `feed_ts IS NOT NULL`
- `lag_ms = feed_ts - book_last_move_ts >= 5000` (≥ 5s)
- `book_price IS NOT NULL` (we actually had a line to react to)

Everything else — `no_book_or_suspended`, suspended markets, skips with no book — is dropped from this feed entirely.

### Header strip (replaces noise)

Three small counters above the feed so the dropped data still gets accounted for:

```text
[ Delay catches: 12 ]  [ No book / suspended: 142 ]  [ Real-line fires: 4 ]
                       (24h window)
```

Clicking "No book / suspended" opens a small drawer with that subset — they're not gone, just not in the main view.

### Columns (per row)

| Time | Game | Event | Player | Side | Book | Lag | Edge | Decision |
|------|------|-------|--------|------|------|-----|------|----------|

- **Lag**: the headline number, e.g. `7.4s`, colored amber 5–10s, red >10s, with a small horizontal bar scaled to the slowest lag in view.
- **Book**: which book was late (DK, FD, MGM, etc.).
- **Decision**: `fire` / `skip` — and skip-reason chip only if it's `book_reacted` or `stale_feed` (the interesting skips). Boring skips don't qualify under the filter anyway.

### Empty-state callout (this is what you'll see today)

When the filter returns zero rows AND `book_id` is null on 100% of recent events, show a prominent banner instead of an empty table:

```text
⚠ No book data in last 24h
The fair-price engine logged 38 events but every one was "no_book_or_suspended".
The book snapshot feed isn't writing rows (book_snapshot: 0 in 24h).
Until that's fixed, lag cannot be measured. [View raw events →]
```

This makes the actual problem visible instead of hiding it behind a wall of identical WARN rows.

## What stays / what goes

**Keep on the page:**
- Top KPI cards (fire/skip rates, hit rate, CLV)
- Book Latency Leaderboard card (already added) — will show "(awaiting book data)" until snapshots flow
- Histogram of `feed_ts − book_last_move_ts` — same gating
- Per-game drill-down sheet

**Replace:**
- The current "Events Feed (last 24h, max 200)" table — this is the noise you screenshotted.

**Remove from default view:**
- The `All / FIRE / SKIP` + `Any sev / WARN / INFO` + `Any side / HOME / AWAY` chip rows on the feed. They're filtering noise. New default = delay catches only, with one toggle "Show raw events" that reveals the old unfiltered table for debugging.

## Technical notes

- Single file edit: `src/pages/admin/MlbFairPriceDashboard.tsx`
- Add `delayCatches = useMemo(...)` deriving from existing `events` state (no new query)
- Add `noBookCount` / `realLineCount` counters from same array
- New `<DelayCatchesTable />` block inline
- Wrap existing feed table in a `<details>` / collapsible "Show raw events"
- No schema changes, no edge function changes, no cron changes
- Polling stays at 15s as-is

## Out of scope (call out, don't fix here)

- Why `book_snapshot` is empty — that's a scraper/worker issue. Flag in UI banner, separate ticket.
- Lag leaderboard ranking math — already implemented, will populate once book data flows.

