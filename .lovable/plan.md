

Goal: Stop being blocked by the risk layer entirely. Bypass `nba_risk_engine_picks` as a hard gate and let the pipeline produce picks directly from live `unified_props` + any available support data (sweet spots, L10, season averages), so the slate generates today even when the risk engine returns 0 approved rows.

What will change

1. Make the risk layer optional, not required
- In `supabase/functions/_shared/direct-pick-sources.ts`:
  - Treat `nba_risk_engine_picks` as a soft signal (boost), not a precondition.
  - Always run the fallback path (sweet spots + raw `unified_props`) regardless of risk row count.
  - Add a third source: raw `unified_props` for today, joined to whatever historical context exists (game logs / season averages) when sweet spots are also empty.

2. Add a raw-props fallback so the pipeline can never starve
- New helper in `direct-pick-sources.ts` that:
  - Pulls today's `unified_props` rows (NBA, fresh `odds_updated_at`).
  - For each prop, computes a lightweight composite score using:
    - season average vs. line (from `nba_player_game_logs` aggregate, or `player_season_stats` if present)
    - implied probability from posted odds
    - recency boost if line moved in the last hour
  - Emits `DirectPickRow` with `source_origin: "raw_props"` and a clear `category` inferred from prop type.
- This guarantees a non-empty pool whenever `unified_props` has rows.

3. Remove risk-layer hard gates from the orchestrator
- In `supabase/functions/refresh-l10-and-rebuild/index.ts`:
  - Remove early-return on `blocked:risk_empty` / `blocked:risk_thin`.
  - Replace with a soft warning logged into `bot_activity_log` and a `risk_layer: "bypassed"` flag in the response, then continue to downstream generation using the new raw-props source.
- In `supabase/functions/nba-player-prop-risk-engine/index.ts`:
  - Keep it running for analytics, but make its output advisory only — never block the slate.

4. Update preflight + UI so the bypass is visible, not silent
- In `src/hooks/usePipelinePreflight.ts`: surface `risk_layer_status` ("active" | "bypassed" | "empty") alongside existing `blockCode`.
- In `src/components/market/SlateRefreshControls.tsx` and `src/components/bot/ShadowPicksFeed.tsx`: show a small badge "Risk layer: bypassed — using raw props + sweet spots" when active, so we always know the source mix.
- In `src/pages/BotLegDiagnostics.tsx`: add a "Source origin" column (risk / fallback / raw_props) so we can audit what's actually feeding picks.

5. Verify by invoking the repaired pipeline
- After deploy, invoke in order:
  - `refresh-todays-props`
  - `refresh-l10-and-rebuild` (which now bypasses risk gates)
- Confirm via DB query that `bot_daily_pick_pool` is non-empty for today's ET date.
- If still empty, the only remaining cause is `unified_props` itself being empty — which is now the single, unambiguous failure mode.

Technical details
- `direct-pick-sources.ts` becomes the single source of truth for "what picks exist today." It returns rows tagged by origin so downstream consumers (parlay builder, shadow feed, diagnostics) can weight them differently if desired.
- Composite score for raw-props fallback (clamped 1–99):
  - 50% implied-prob delta vs. season-avg-implied
  - 30% line-vs-season-avg edge
  - 20% odds freshness / movement
- No schema changes required. No new tables. No migrations.
- Risk engine code is preserved and still runs for analytics; only its gating power is removed.

Files touched
- `supabase/functions/_shared/direct-pick-sources.ts` (add raw-props source, remove risk-as-gate)
- `supabase/functions/refresh-l10-and-rebuild/index.ts` (remove risk hard gates)
- `supabase/functions/nba-player-prop-risk-engine/index.ts` (advisory mode flag in response)
- `src/hooks/usePipelinePreflight.ts` (expose risk_layer_status)
- `src/components/market/SlateRefreshControls.tsx` (bypass badge)
- `src/components/bot/ShadowPicksFeed.tsx` (bypass badge + source mix line)
- `src/pages/BotLegDiagnostics.tsx` (source origin column)

Expected outcome
- Risk layer can return 0 rows and the slate still generates.
- Picks always flow from the best available source: risk → sweet spots → raw `unified_props`.
- The only remaining hard blocker becomes "no live props at all," which is upstream and already debuggable.

