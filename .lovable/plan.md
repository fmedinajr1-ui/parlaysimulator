
Goal: fully repair the upstream pipeline so today’s generators can produce again by restoring fresh live odds, repopulating source tables, and exposing exact block reasons when upstream stages fail.

What will change

1. Repair `refresh-todays-props` freshness + date handling
- Replace the local UTC date construction in `supabase/functions/refresh-todays-props/index.ts` with the shared Eastern-time helper pattern so “today” always matches the rest of the pipeline.
- Fix the current ET boundary logic that hardcodes `-05:00`; use a DST-safe ET date strategy so today’s games are selected correctly year-round.
- Ensure every inserted/upserted `unified_props` row carries reliable freshness fields used by all gates:
  - `odds_updated_at`
  - `updated_at` fallback compatibility
- Preserve the current trusted-bookmaker filtering and Ball Don’t Lie fallback, but make the function return richer diagnostics:
  - events found
  - events in ET window
  - props parsed
  - props inserted
  - data source used
  - latest row freshness timestamp

2. Harden the risk engine against empty/stale upstream input
- Update `supabase/functions/nba-player-prop-risk-engine/index.ts` to use the same canonical ET helper as the rest of the backend.
- Tighten the initial `unified_props` pull so it only analyzes rows that are both relevant to the current ET slate and fresh enough to be actionable.
- Expand its response diagnostics so the orchestrator and dashboard can see:
  - total props scanned
  - fresh props scanned
  - distinct players scanned
  - approved count
  - thin-day fallback requested/triggered
  - top rejection reasons
  - latest supporting game-log freshness
- If source props are empty or stale, return an explicit blocked reason instead of just producing zero approved picks.

3. Restore fallback source visibility and sweet-spot health
- Trace all active runtime dependencies on `category_sweet_spots` and keep it as a monitored fallback source rather than an assumed healthy source.
- Add explicit health checks around `category_sweet_spots` in the orchestrator and diagnostics so the system distinguishes:
  - fallback source empty
  - fallback source stale-date mismatch
  - fallback source present but nonessential
- If risk rows are thin but sweet spots exist, keep current fallback behavior; if both are empty, surface that as a first-class upstream failure.

4. Upgrade orchestrator preflight from generic “thin” to stage-level block states
- Extend `supabase/functions/refresh-l10-and-rebuild/index.ts` so Phase 2/3 preflight records stage-specific statuses before generation:
  - `blocked:stale_odds`
  - `blocked:no_props_for_today`
  - `blocked:risk_empty`
  - `blocked:risk_thin`
  - `blocked:sweet_spots_empty`
  - `blocked:no_usable_matches`
- Keep the FanDuel freshness gate, but log and return richer evidence:
  - fresh FanDuel count
  - latest FanDuel update
  - latest any-book update
  - post-refresh retry counts
- When the risk engine returns low volume, include its rejection summary in the warning/alert payload instead of only the final approved count.

5. Expand the dashboard from simulation-only coverage into true upstream health
- Extend `src/hooks/useSimulationCoverageDiagnostics.ts` so it also reports upstream ingest health, not just match coverage:
  - latest odds ingest time
  - latest risk row time
  - latest sweet-spot row time
  - stale source counts
  - readiness by stage
  - explicit block code
- Update `src/components/bot/ShadowPicksFeed.tsx` so the panel explains the failed stage in plain language:
  - Odds stale
  - No live props for today
  - Risk engine found nothing usable
  - Sweet-spot fallback unavailable
  - Book matches failed due to stale rows / missing prices / line drift
- Keep the current summary cards and progress bars, but add a compact “Upstream stages” section so zero outputs are immediately traceable.

6. Add a backend diagnostic endpoint for source-stage audits
- Expand or adapt the existing diagnostics function pattern so there is one backend response that summarizes, for a target ET date:
  - `unified_props` freshness by bookmaker
  - risk engine approvals and rejection reasons
  - sweet-spot fallback counts
  - parlay/straight/uploaded output counts
  - last successful timestamps per source
- This becomes the single source of truth for both admin debugging and the dashboard hook.

7. Validate end-to-end recovery after the repair
- Re-run the upstream sequence in order:
  1. refresh today’s props
  2. run risk engine
  3. verify fallback source availability
  4. run orchestrator generation
- Confirm all of the following:
  - fresh FanDuel rows exist inside the freshness window
  - ET date alignment matches current slate
  - approved `nba_risk_engine_picks` exist for today
  - fallback sweet spots are correctly classified as available or absent
  - parlay / straight / uploaded generators receive usable direct-source rows
  - the dashboard shows `ready` or a precise blocked reason instead of generic zero-output ambiguity

Files expected to change
- `supabase/functions/refresh-todays-props/index.ts`
- `supabase/functions/nba-player-prop-risk-engine/index.ts`
- `supabase/functions/refresh-l10-and-rebuild/index.ts`
- `supabase/functions/bot-leg-production-diagnostics/index.ts`
- `src/hooks/useSimulationCoverageDiagnostics.ts`
- `src/components/bot/ShadowPicksFeed.tsx`
- possibly `supabase/functions/_shared/date-et.ts` usage imports where ET logic is standardized

Technical details
- The current main upstream weakness is in `refresh-todays-props`: it still uses `toISOString().split('T')[0]` and a hardcoded `-05:00` ET boundary, which risks wrong-day slates and stale freshness behavior.
- `nba-player-prop-risk-engine` currently reads all active NBA props with only a broad `commence_time >= today` filter and depends on `category_sweet_spots` for L10 hit-rate context; if upstream props are stale or misdated, the engine starves.
- The project memory already establishes ET standardization as a core rule and requires real-line validation against live `unified_props`.
- The repair focuses on restoring upstream source truth first, then making block reasons visible so the system is debuggable the next time data quality drops.
