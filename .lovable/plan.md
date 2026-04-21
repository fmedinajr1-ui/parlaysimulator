

## Refresh odds, then broadcast tonight's slate

Quick 2-step recovery so we can ship tonight's parlays.

### Step 1 — Refresh `unified_props`

Invoke the existing odds-sync job that populates `unified_props` for tonight's NBA games. Based on the codebase, the canonical refreshers are:

- `fetch-current-odds` (per-event, used for hedge/scout)
- The high-frequency feed referenced in `mem://infrastructure/market-data/fanduel-integration` that writes to `unified_props.odds_updated_at`

I'll invoke whichever one is wired to bulk-refresh `unified_props` for today's slate. After it completes, verify with:

```sql
SELECT bookmaker, COUNT(*), MAX(odds_updated_at)
FROM unified_props
WHERE event_id IN (today's NBA events)
GROUP BY bookmaker;
```

Pass = at least FanDuel rows with `odds_updated_at` within the last 5 minutes.

### Step 2 — Re-invoke the broadcast

```ts
supabase.functions.invoke('parlay-engine-v2-broadcast', {
  body: { generate_first: true, preset: 'v2.3-balanced', dry_run: true }
});
```

Dry run first to confirm:
- Rejection reasons no longer dominated by `leg:stale_book_line`
- New parlays are populated with `[FD]` book tags
- Leg count > 0

Then flip `dry_run: false` and ship to `@parlayiqbot`. Existing dedup table prevents the 2 already-sent parlays from re-posting.

### Fallback if Step 1 returns no fresh data

If the odds source has no tonight's NBA games (late slate, source down), I'll report back and we decide between:
- Widening freshness gate to 6h for tonight only (one-line config bump, revert tomorrow)
- Skipping tonight's auto-broadcast and waiting for tomorrow's morning cron

No code/schema changes needed for the happy path — just two function invocations and a verification query.

