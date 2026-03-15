

# Regenerate March 15 Parlays

Now that both fixes are deployed (L3 date filter + light-slate diversity thresholds), we'll trigger a full Clean & Rebuild to regenerate today's slate.

## Steps

1. **Invoke the `refresh-l10-and-rebuild` orchestrator** — this runs the complete 13-step pipeline: sync game logs → void stale pending parlays → clean props → defense scan → category analysis → mispriced detection → risk engine → quality-gated regen → curated pipeline → sharp/heat builders → diversity rebalance → slate status broadcast.

2. **Verify results** — query `bot_daily_parlays` for March 15 non-voided parlays to confirm more survived with the new light-slate thresholds.

3. **Invalidate frontend queries** — refresh all parlay-related React Query caches so the dashboard reflects the new slate immediately.

No code changes needed — just invoking the existing pipeline via the `refresh-l10-and-rebuild` edge function, which already contains the deployed fixes.

