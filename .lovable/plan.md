## Goal

Replace the colored cylinder/sphere markers in the live 3D scenes with low-poly humanoid avatars that wear team colors and display jersey numbers, holding sport-appropriate static poses.

## What changes

### 1. New shared component: `PlayerAvatar`
`src/features/live3d/components/PlayerAvatar.tsx`

A reusable Three.js humanoid built from primitives:
- Head (sphere), torso (rounded box), upper/lower arms (cylinders), upper/lower legs (cylinders), feet (boxes).
- `teamColor` drives jersey + shorts; skin tone neutral; outline rim on jersey for contrast against turf/court.
- `number?: number` rendered on the back of the torso via a `<canvas>` texture (drawn once, memoized). Falls back to no number when undefined.
- `pose` prop: `"idle" | "shooting" | "running" | "batting" | "pitching" | "skating" | "goalie"` — each pose just sets joint rotations on the mesh, no animation.
- Roughly 8 meshes per avatar, all `<group>`-parented so the parent transform from each scene continues to drive position/facing.

### 2. Pose presets
`src/features/live3d/components/poses.ts`

Per-pose joint rotation tables (radians) so scenes can pick a pose by string without redefining math each time. Examples:
- Basketball: 4 in `idle`, 1 in `shooting` (ball-handler).
- Baseball: 1 in `batting`, 1 in `pitching` (mound), 7 in `idle` (fielders).
- Football: QB in `running` if possession === offense, rest `idle`.
- Hockey: skaters in `skating`, one `goalie`.
- Soccer: keeper `goalie`, rest `idle`/`running`.

### 3. Scene refactors (one per file, minimal logic change)
- `BasketballScene.tsx` — replace player cylinders with `<PlayerAvatar>`. Keep existing X/Z layout and team-color logic; pass `number` from a small per-side roster array (1–5).
- `BaseballScene.tsx` — diamond fielders + batter/pitcher use `<PlayerAvatar>` with sport poses.
- `GenericFieldScene.tsx` (football/hockey/soccer) — same swap, pose chosen by `kind`.

### 4. Jersey numbers
For v1 the numbers are deterministic placeholders (1, 2, 3, …) per side. We don't fetch live lineups yet — when you want real names/numbers we can wire `playerJerseyLookup` / `starting_lineups` into the scene in a follow-up. This keeps the change purely visual and avoids touching data pipelines.

### 5. Performance
- Avatar geometry/materials are shared (`useMemo` at module scope) so 22 avatars share ~6 buffers.
- Number canvases cached in a `Map<number, CanvasTexture>` keyed by digit.
- No new dependencies — uses `three` + `@react-three/fiber` already installed.

## Files touched
- add: `src/features/live3d/components/PlayerAvatar.tsx`
- add: `src/features/live3d/components/poses.ts`
- edit: `src/features/live3d/scenes/BasketballScene.tsx`
- edit: `src/features/live3d/scenes/BaseballScene.tsx`
- edit: `src/features/live3d/scenes/GenericFieldScene.tsx`

## Out of scope (call out if you want next)
- Real lineups / live roster numbers per game.
- Animation (run cycle, idle bob) — explicitly skipped per your answer.
- Player name labels above heads.
- Per-team secondary colors / logos on the jersey.