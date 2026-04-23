
Goal: remove the `bot_daily_pick_pool` dependency from generation flow and make the parlay/straight/uploaded generators read directly from live source tables, while preserving the current safety gates and verifying the odds/stat feeds still support the pipeline.

What will change

1. Replace pick-pool staging with direct candidate loading
- Refactor `parlay-engine-v2` so it builds candidate legs directly from:
  - `nba_risk_engine_picks` as the primary ranked source
  - `category_sweet_spots` as the fallback source when risk output is thin
  - `unified_props` for live line matching, price selection, freshness, and drift checks
- Recreate the current composite scoring in-memory so the engine still gets differentiated rankings without needing rows prewritten to `bot_daily_pick_pool`.

2. Remove pick-pool gating from orchestration
- Update `refresh-l10-and-rebuild` to stop using:
  - `getPoolCount`
  - `MIN_PICK_POOL_ROWS`
  - `phase3b_pool`
  - `thin_pool` blocking for uploaded pipeline and parlay generation
- Replace those checks with direct source-health checks:
  - approved risk pick count
  - fallback sweet-spot count
  - fresh `unified_props` count
- Keep the existing odds freshness gate, since that protects against stale line generation.

3. Refactor uploaded pipeline generator to read direct sources
- Remove its dependence on pool size as a precondition.
- Let it score directly from:
  - multi-book `unified_props`
  - `prop_candidates`
  - `bot_owner_rules`
- Keep its existing zero-output warning, but make the warning explain the real cause:
  - insufficient multi-book coverage
  - missing `prop_candidates`
  - conflicting manual override rules
  instead of “thin pool”.

4. Refactor straight-bet generation the same way
- Update `bot-generate-straight-bets` to load the same direct candidate set instead of reading `bot_daily_pick_pool`.
- Preserve current ranking, freshness, and line-availability protections.

5. Keep the feeds, remove only the staging layer
- `refresh-todays-props` remains the live odds ingestion path.
- `nba-stats-fetcher` remains the NBA historical/stats sync path with ESPN primary and Ball Don’t Lie fallback.
- No removal of the real data sources; only the intermediate staging table is removed from runtime generation.

Validation to perform after implementation

1. Verify live feed readiness
- Invoke the prop refresh path and confirm `unified_props` receives fresh active rows.
- Invoke the NBA stats fetcher and confirm historical rows still populate from the current fetch logic.
- Confirm the orchestration logs show direct-source counts instead of pool counts.

2. Verify direct parlay generation
- Run the orchestrator and confirm parlays generate without `build-daily-pick-pool`.
- Confirm no phase is blocked for `thin_pool`.

3. Verify direct uploaded-pipeline generation
- Invoke uploaded pipeline through the orchestrator and directly.
- Confirm it can run without a pool prerequisite.

4. Verify straight bets
- Confirm straight bet generation still works from direct sources.

5. Regression checks
- Ensure line freshness gate still blocks stale data.
- Ensure same-game concentration and distinct-game guards still behave the same.
- Ensure ranking remains non-flat after removing pool persistence.

Files expected to change
- `supabase/functions/refresh-l10-and-rebuild/index.ts`
- `supabase/functions/parlay-engine-v2/index.ts`
- `supabase/functions/bot-generate-straight-bets/index.ts`
- `supabase/functions/uploaded-pipeline-generator/index.ts`
- possibly shared helper extraction under `supabase/functions/_shared/` if direct candidate loading is centralized

Technical notes
- Right now the Odds feed is wired through `refresh-todays-props`, which writes into `unified_props`.
- Ball Don’t Lie is also wired in code: `nba-stats-fetcher` uses ESPN first and Ball Don’t Lie as fallback, and `refresh-todays-props` has Ball Don’t Lie fallback logic for props.
- The “pick pool” is currently not just a list; it is a staging/ranking layer used by parlay and straight-bet generators. Removing it requires moving its normalization, dedupe, fallback, and composite-score logic into the generators or a shared loader.
- The safest implementation is not to delete the table first, but to remove all runtime reads/writes to it, verify output parity, and only then decide whether the table can be retired fully.
