## Goal

Replace the Three.js scenes on `/live/:gameId` with a flat, premium 2D visualization inspired by ESPN Gamecast, NFL Next Gen Stats, Bloomberg Terminal, and Apple Sports. No 3D, no realistic models. Focus on prediction visibility and sportsbook edge.

## Scope

- Replace the right-side scene area in `src/pages/LiveGame.tsx` with a new 2D terminal view.
- Keep existing data sources (`useLiveGameState`, `usePropQuotes`, `live_game_state`, `live_prop_quotes`) untouched.
- Keep `Scoreboard` and `PropBookGrid`.
- Old `live3d/scenes/*` and `PlayerAvatar`/`poses` become unused; delete after wiring.

## New module: `src/features/liveterminal/`

```
liveterminal/
  TerminalView.tsx           # top-level layout (pitch panel + side intel)
  PitchPanel.tsx             # SVG field/court/diamond/rink router by sport
  pitches/
    BasketballPitch.tsx      # half-court SVG, hoop, 3pt arc, paint
    FootballPitch.tsx        # 100yd field, hashes, endzones, line of scrimmage
    BaseballDiamond.tsx      # diamond, bases, mound, outfield arcs
    HockeyRink.tsx           # rink, blue lines, faceoff dots, crease
    SoccerPitch.tsx          # pitch, midline, boxes, goal areas
  PlayerToken.tsx            # circular headshot, team-color ring, number, state ring
  layers/
    TrailLayer.tsx           # fading SVG polylines for movement trails
    GhostLayer.tsx           # dashed "predicted next position" tokens at 30% opacity
    TrajectoryLayer.tsx      # shot arcs / route trees / pass lanes (SVG paths + arrowheads)
    PossessionLayer.tsx      # glowing chevron/halo on ball-carrier
    PredictionOverlay.tsx    # floating tags: "Next: PnR right · 64%"
  panels/
    NextPlayPanel.tsx        # ranked list of likely next plays w/ probabilities
    InvolvementPanel.tsx     # player involvement %, usage bars
    EdgePanel.tsx            # prop, FD line, model proj, edge%, color-coded
    LegendPanel.tsx          # state-color legend (green/red/orange/purple/yellow)
  state/
    playerStates.ts          # type PlayerState = "over_pace" | "under_pace" | "usage_spike" | "sharp_action" | "volatility" | "neutral"
    stateColors.ts           # token map → CSS variables
    mockFeed.ts              # deterministic synth feed until real signals wired
  hooks/
    usePlayerStates.ts       # derives state per player from live_prop_quotes + projections (mock first)
    useFormationLayout.ts    # sport-specific x/y coords (0..1 space) per player
  types.ts
```

## Layout

```text
┌───────────────────────────────────────────────────────────────────┐
│ Scoreboard (existing)                                             │
├──────────────────────────────────────────┬────────────────────────┤
│ PitchPanel (SVG, fills column)           │ Multi-book prop grid   │
│  · field/court background                │ (existing PropBookGrid)│
│  · TrailLayer  (under tokens)            │                        │
│  · TrajectoryLayer                       │                        │
│  · GhostLayer                            │                        │
│  · PlayerTokens (5/11/6 per sport)       │                        │
│  · PossessionLayer                       │                        │
│  · PredictionOverlay (anchored tags)     │                        │
├──────────────────────────────────────────┤                        │
│ NextPlayPanel │ InvolvementPanel │ Edge  │                        │
└───────────────┴──────────────────┴───────┴────────────────────────┘
```

Bottom strip under the pitch hosts `NextPlayPanel`, `InvolvementPanel`, `EdgePanel`, `LegendPanel` in a 4-col grid (stacks on mobile).

## Visual language (design tokens)

Add to `src/index.css`:

- `--term-bg: 222 47% 6%` (near-black navy)
- `--term-grid: 222 30% 14%`
- `--term-text: 210 20% 92%`
- `--term-muted: 215 16% 60%`
- `--state-over: 142 76% 45%` (green)
- `--state-under: 0 75% 58%` (red)
- `--state-usage: 28 96% 56%` (orange)
- `--state-sharp: 270 80% 65%` (purple)
- `--state-volatility: 48 100% 60%` (yellow)
- `--edge-positive: var(--state-over)`
- `--edge-negative: var(--state-under)`

Type: tabular-nums everywhere (`font-variant-numeric: tabular-nums`), uppercase tracking-widest for labels, mono for prices/edges (Bloomberg feel).

## PlayerToken spec

- 40px circle. Inner: `<image>` headshot (fallback initials over team color).
- Outer ring: 3px solid `teamColor`.
- State ring: 2px ring outside team ring, color = current `PlayerState`, animated `pulse` when `usage_spike` or `sharp_action`.
- Jersey number: small chip top-right.
- Position label: 2-letter abbr below.
- Hover: tooltip with line / proj / edge% pulled from `live_prop_quotes` + projection (mock first).

## Animations

CSS + SVG only (no three.js, no extra deps):

- **Trails**: rolling buffer of last 8 positions per player → SVG polyline with linear gradient stroke fading to transparent.
- **Ghost futures**: dashed circle at `predictedNext` with 30% opacity, animated `stroke-dashoffset`.
- **Possession**: pulsing halo + small chevron under ball carrier.
- **Shot trajectories / routes**: SVG `<path d>` with `pathLength` stroke-dash draw-in animation; arrowhead `<marker>`.
- All under 60fps; `prefers-reduced-motion` disables loops.

## Data wiring

Phase 1 ships with deterministic mock layouts + mock state assignments seeded by `game_id` so the view is always populated. Real wiring (separate follow-up if approved):

- Player states from `player_prop_hitrates`, `market_signals` (`sharp_action`), `juiced_props` (`volatility`), live pace vs projection.
- Edge% from `live_prop_quotes` (best book over/under) vs `model_predictions` / `final_verdict_picks`.
- Next-play probabilities from `coach_game_tendencies` + situation.

Plan only touches Phase 1 (mock feed) so the visual ships first. No new tables, no new edge functions, no migrations.

## File changes

Create:
- All files under `src/features/liveterminal/` listed above.

Edit:
- `src/pages/LiveGame.tsx` — swap `<SceneFrame>{renderScene(state)}</SceneFrame>` for `<TerminalView state={state} quotes={quotes} />`. Drop the `renderScene` helper and three.js scene imports.
- `src/index.css` — add terminal + state-color tokens.

Delete (after swap compiles):
- `src/features/live3d/scenes/SceneFrame.tsx`
- `src/features/live3d/scenes/BasketballScene.tsx`
- `src/features/live3d/scenes/BaseballScene.tsx`
- `src/features/live3d/scenes/GenericFieldScene.tsx`
- `src/features/live3d/components/PlayerAvatar.tsx`
- `src/features/live3d/components/poses.ts`

Keep:
- `live3d/hooks.ts`, `live3d/types.ts`, `live3d/components/Scoreboard.tsx`, `live3d/components/PropBookGrid.tsx` (rename folder later if desired — not in scope).

## Out of scope

- Real player headshots CDN integration (use initials + colored disc fallback first; `playerJerseyLookup` only seeds numbers).
- Real predicted-movement model — ghost positions are stylistic (small offset along possession vector).
- Replacing `PropBookGrid` — stays as-is on the right.
- Mobile redesign beyond responsive stacking.
