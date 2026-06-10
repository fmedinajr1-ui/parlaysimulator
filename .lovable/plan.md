# Live 3D Game View + Multi-Book Prop Panel

A new `/live/:gameId` route that pairs a 3D broadcast-style visualization of an in-progress game with a sticky scoreboard and a side-by-side sportsbook prop comparison panel.

## Scope Reality Check (read first)

You picked **realistic broadcast-style across NBA/WNBA/NCAAB, NFL/NCAAF, MLB, NHL, Soccer**. That is a multi-month, multi-thousand-dollar effort if taken literally:

- Real player models per sport = licensed 3D assets or custom rigging (10–50 MB each, hundreds of players).
- Real x/y/z tracking data is **not free**. The realistic providers:
  - **Sportradar** (NBA/NFL/NHL/MLB/Soccer) — enterprise pricing, typically $2k–$20k+/mo.
  - **Genius Sports** (NFL/NBA Next Gen Stats reseller) — enterprise only.
  - **StatsPerform / Opta** (Soccer/NCAA) — enterprise.
  - **MLB Statcast** — free historical, **no public live feed**.
- No tier of The Odds API (what we already use) returns play-by-play coordinates.

**My recommendation: ship a "broadcast-style stylized" v1, not literal-realism v1.** It still looks premium (think NBA League Pass "Mosaic" view, not 2K graphics) and is achievable in days, not months. We can layer realism on later if a data deal happens.

If you want literal realism now, the plan changes to "procure data partnership first, build second" and I should stop and get you on a call with Sportradar before any code.

Assuming **stylized broadcast v1**, here is the plan.

## What gets built

### 1. Route + layout: `/live/:gameId`

```text
+----------------------------------------------------+
|  HOME 78  ─────  AWAY 74   Q3 4:32   ⏺ LIVE        |  ← scoreboard (sticky)
+----------------------------------------------------+
|                                  |                  |
|        3D COURT / FIELD          |  PROP COMPARE    |
|        (react-three-fiber)       |  ┌──────────────┐|
|        - ball position           |  │ Tatum Pts    │|
|        - possession marker       |  │ FD  o27.5 -110│|
|        - player dots w/ numbers  |  │ DK  o27.5 -115│|
|        - team-colored court      |  │ MGM o28.5 +105│|
|                                  |  │ ...          │|
|                                  |  └──────────────┘|
+----------------------------------------------------+
```

Mobile: scoreboard top, 3D view middle (60vh), prop panel collapses into a bottom sheet.

### 2. Sport-specific 3D scenes (`src/features/live3d/scenes/`)

One scene component per sport, all sharing a `<Field>` base:
- `BasketballScene` — half-court textures, hoop, ball, 10 player markers
- `FootballScene` — gridiron with yard lines, ball spot, down marker, 22 markers
- `BaseballScene` — diamond, bases (lit when occupied), pitch zone, 9 fielders
- `HockeyScene` — rink, puck, 12 markers
- `SoccerScene` — pitch, ball, 22 markers

Player markers = team-colored cylinders with jersey-number sprite. Ball/puck = sphere with trail. Camera orbits via OrbitControls; preset "Broadcast", "Overhead", "End-zone" buttons.

### 3. Live data feed

- **Score / clock / possession / outs / down-and-distance**: poll The Odds API `/scores` every 15s (already wired) + a new `live-game-state-sync` edge function that normalizes per sport into a `live_game_state` row.
- **Ball / player positions**: **simulated** in v1 from coarse signals (possession team → ball near their hoop; pitch in progress → ball at mound→plate; etc.). Honest UI label: "Visualized — not tracked." This is the only intellectually honest option without a tracking-data deal.
- Realtime: subscribe to `live_game_state` via Supabase Realtime so the scene updates without polling on the client.

### 4. Multi-book prop comparison

- New edge function `multibook-props-sync` queries Odds API `/events/{id}/odds` with `bookmakers=fanduel,draftkings,betmgm,williamhill_us,betrivers,espnbet,pinnacle,...` for the active game.
- Persists into a new `live_prop_quotes` table: `(event_id, player_name, prop_type, line, book, over_price, under_price, fetched_at)`.
- UI: searchable list of player props. Each row expands to a book-by-book grid with best price highlighted and an "edge vs Pinnacle" tag when Pinnacle is present.

### 5. Game list page `/live`

Grid of currently-live games (pulled from `live_game_scores` we already have) → click → 3D view.

## Technical Details

- **3D**: `@react-three/fiber@^8.18` + `@react-three/drei@^9.122.0` (per project constraints, React 18).
- **New tables**:
  - `live_game_state` (game_id PK, sport, period, clock, home_score, away_score, possession, situation_json, updated_at) + Realtime publication + RLS read-for-authenticated.
  - `live_prop_quotes` (composite unique on event_id+player+prop+book) + RLS.
  - Both get the full GRANT block per project rules.
- **New edge functions**:
  - `live-game-state-sync` (cron every 15s while any game is live)
  - `multibook-props-sync` (cron every 60s while any game is live; respects Odds API budget table `api_budget_tracker`)
- **Client**:
  - `src/features/live3d/` (scenes, hooks, camera presets)
  - `src/features/live3d/components/Scoreboard.tsx`
  - `src/features/live3d/components/PropBookGrid.tsx`
  - `src/pages/LiveGames.tsx`, `src/pages/LiveGame.tsx`
- **Cost guardrails**: only poll/sync while at least one game is `status='in_progress'`; otherwise the cron returns immediately. Multi-book sync limited to games actually being viewed (write a `viewing_heartbeat` row, only sync games with a heartbeat in last 2 min) to keep Odds API credits sane.
- **Honest labeling**: a small "Visualized • not player-tracked" badge sits in the 3D corner so users aren't misled.

## Out of scope for v1 (call out so you can confirm)

- Real player skeletons / animations
- Real x/y/z tracking (needs Sportradar/Genius deal)
- Replay scrubbing / historical games
- AR / VR / fullscreen broadcast mode
- Betting-action buttons inside the 3D scene

## Open question before I build

The single biggest fork: **do you accept stylized broadcast v1 with simulated positions?** If yes, I build the above. If you want literal-realistic tracked positions, I stop and we scope a Sportradar (or equivalent) procurement first — no point writing code that has no data to drive it.
