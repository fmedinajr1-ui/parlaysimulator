# MLB Fair-Price Admin Dashboard

A new admin-only page at `/admin/mlb-fair-price` that lets you watch the engine fire in real time, audit completeness, and drill into any in-progress game — same spirit as the NBA Scout War Room.

## Route & access

- New page: `src/pages/admin/MlbFairPriceDashboard.tsx`, lazy-loaded in `src/App.tsx` at `/admin/mlb-fair-price`.
- Gated by `useAdminRole()`; non-admins get redirected to `/admin-login` (same pattern as other admin pages).
- Add a card/link on `src/pages/Admin.tsx` index so it's discoverable.

## Layout

Three stacked sections, each independently refreshing:

```text
┌──────────────────────────────────────────────────────────────┐
│ Header: MLB Fair-Price v1 · measurement mode · last refresh  │
├──────────────────────────────────────────────────────────────┤
│ 1. Completeness strip (14d, daily rows from view)            │
│    fires · outcome-attached · closing-resolved · avg latency │
├──────────────────────────────────────────────────────────────┤
│ 2. Live game strip (today's MLB games w/ engine activity)    │
│    one tile per game → click to open game drawer             │
├──────────────────────────────────────────────────────────────┤
│ 3. Recent events feed (last 200 fires/skips, filterable)     │
└──────────────────────────────────────────────────────────────┘
```

### 1. Completeness panel
Source: `mlb_fair_price_event_completeness` view. Table with one row per day for the last 14 days:
- date, fires, outcome_attached, closing_attached, both, avg fire→outcome latency, avg fire→closing latency, % missing closing.
- Color-code rows where completeness < 90%.
- Top of panel shows 24h + 7d rollup tiles (reuse `StatsCard`/`StatItem`).

### 2. Live game strip
For each MLB `game_id` with any event in the last 6h or `live_game_scores.status` in (`scheduled`,`in_progress`) for today:
- Tile shows: matchup (away @ home), score, inning/status, fires count, last event time, last `gate_decision`, current `edge` if open.
- Joined from `mlb_fair_price_events` + `live_game_scores`.
- Click → opens **Game Drawer**:
  - Header: matchup, live score, current inning.
  - WP timeline chart (recharts line): `wp_pre` / `wp_post` over `event_time` for that game.
  - Snapshot panel: latest `mlb_live_ml_snapshots` row (home/away price, devig, captured_at, suspended).
  - Events table: every row from `mlb_fair_price_events` for this game ordered desc — columns: time, side, market, edge%, EV%, book_price/opposite_price, gate_decision, skip_reason, severity, telegram_sent, realized_hit (if attached), clv_pct (if resolved).
  - Manual actions: "Re-run outcome attacher", "Re-run closing resolver" (invoke existing edge functions scoped to this `game_id`).

### 3. Recent events feed
Global, last 200 rows from `mlb_fair_price_events` ordered by `created_at desc`. Filters:
- gate_decision (fire / skip)
- severity (WARN / INFO)
- has_closing (yes/no/null)
- side (HOME/AWAY)
- search by `game_id`
Each row: timestamp, game (clickable → opens game drawer), event_type, side, edge%, EV%, decision, top skip_reason. Color-code FIRE rows by severity, SKIP rows muted.

Bottom card: **Top skip reasons (24h / 7d)** — bar list grouped by `skip_reason` with counts (matches digest content).

## Data layer

New hooks (TanStack Query, polling every 15s while tab visible):
- `useMlbFpCompleteness()` → `from('mlb_fair_price_event_completeness').select('*').order('day', { desc: true }).limit(14)`
- `useMlbFpLiveGames()` → events grouped by `game_id` for today + join `live_game_scores`
- `useMlbFpGameDetail(gameId)` → events, snapshots, latest score for one game
- `useMlbFpRecentEvents(filters)` → last 200 events with filters
- `useMlbFpSkipReasons(window)` → aggregated counts

All queries use the existing `supabase` client; the view + tables already permit `authenticated` reads.

## Charts & UI primitives

- `recharts` (already in project) for WP timeline.
- Reuse `Card`, `Table`, `StatsCard`, `StatItem`, `Badge`, `Drawer`/`Sheet` from `src/components/ui/`.
- Pattern after `AdminWarRoomView.tsx` for game-tile→drawer flow and styling.

## Component files to create

```
src/pages/admin/MlbFairPriceDashboard.tsx          (page shell, admin gate, layout)
src/components/admin/mlb-fair-price/
  CompletenessPanel.tsx
  LiveGameStrip.tsx
  GameDetailDrawer.tsx
  EventsFeed.tsx
  SkipReasonsCard.tsx
src/hooks/useMlbFairPrice.ts                        (all query hooks)
```

## Out of scope
- No changes to engine, cron, or schema. Read-only dashboard over what's already being recorded.
- No edits to existing edge functions other than allowing optional `game_id` arg on the two re-run buttons — only if the manual-action buttons are desired; flag with confirmation. (Can be deferred.)

## Open questions
1. Should the "manual re-run" buttons in the game drawer be included in v1, or read-only only?
2. Polling cadence — 15s OK, or faster (5s) while you're actively trading?
