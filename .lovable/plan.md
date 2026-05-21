## What's actually wrong in the screenshot

The 4-leg `mega_lottery_scanner` parlay you saw has three independent bugs that combine into "Unknown player … conf 0.66 … conf 0.66 … conf 0.66":

1. **Broadcast labels team/game legs as "Unknown player"**
   `parlay-engine-v2-broadcast/index.ts` → `pickLegPlayer()` falls back to `"Unknown player"` when `player_name` is null. Team and game legs *do* have `team`/`opponent` populated upstream, but the broadcaster never reads them.

2. **No intelligence is applied to team/game legs**
   In `parlay-engine-v2/index.ts` → `buildExtraCandidates()` every team market (Spread / Total / Moneyline) and every raw MLB row is pushed with:
   - `confidence = 0.66` (hard-coded constant)
   - `edge = 0`
   - `projected = line` (no model output)
   That's why every team leg in your screenshot reads `conf 0.66` — there is literally no scoring path. The "model" for team legs is currently a constant.

3. **Mega lottery is stacking the same game's spread twice**
   Legs 2 (`Spread HOME -1.5`) and 4 (`Spread HOME -6.5`) are both home-side spreads on the same game with two different alt lines. Same-game-concentration only caps at ≤0.75 of legs and dedup only keys on `(team, prop_type, side, line)` — different lines pass through, so you get two correlated HOME spreads in one ticket. The memory rule "Drop all 10+ spreads, restrict to fade-heavy outcomes" is also not being enforced for raw team-spread candidates.

## Plan

### 1. Broadcast: real labels for team/game legs
File: `supabase/functions/parlay-engine-v2-broadcast/index.ts`

- Extend the `Leg` type to include optional `team`, `opponent`, `game_description`.
- Replace `pickLegPlayer()` with a `pickLegLabel()` that returns:
  - player leg → `player_name`
  - team leg (Spread/Moneyline) → `"<team> Spread"` / `"<team> ML"` with `(vs <opponent>)` suffix
  - game leg (Total) → `"<away> @ <home> Total"` (or `game_description` when teams are missing)
- Update `buildMessage()` to use the new label and to include the game line under each team/game leg.

### 2. Pass team metadata into the broadcast payload
File: `supabase/functions/parlay-engine-v2/index.ts` (the writer that persists `legs` into the `parlays` row consumed by the broadcaster)

- Persist `team`, `opponent`, `game_description` on every leg JSON so the broadcaster has what it needs without changing the model.

### 3. Real (lightweight) intelligence for team/game legs
File: `supabase/functions/parlay-engine-v2/index.ts` → `buildExtraCandidates()`

Replace the constant `confidence = 0.66` / `edge = 0` block with a model-aware scorer:

- For **spreads**: compute implied win prob from the American price, blend with a 7-day team SU/ATS hit rate (already in `team_results` / `mlb_team_form`), and a market-vs-projection delta from `unified_props_snapshot` opener-vs-current. Output `confidence ∈ [0.55, 0.78]` and `edge = (model_prob − implied_prob)`.
- For **game totals**: blend pitcher quality (MLB) / pace (NBA) when present in `pitcher_form_l5` / `team_pace_l10`, fall back to the opener-vs-current drift. Same confidence/edge ranges.
- For **MLB player raw_props** rows: read from existing `mlb_player_form_l10` (already used elsewhere) to score `confidence` instead of stamping 0.66.
- Apply the existing memory rule "no spreads ≥10, only fade-heavy" by dropping spread candidates with `|line| ≥ 10` and dropping FAV spreads when the team's 10-game ATS hit rate is < 0.45.

If the supporting feature table is missing for a row, leave the candidate out rather than synthesizing a 0.66 — better to ship fewer legs than fake confidence.

### 4. Stop same-game spread stacking
Files: `supabase/functions/_shared/parlay-engine-v2/dedup.ts` and `config.ts`

- Add a `team_side_exposure` map keyed by `${sport}|${team}|${prop_type}|${side}` capped at **1** so two HOME spreads on the same team can never co-occur regardless of alt line.
- Add a `MAX_TEAM_LEGS_PER_GAME = 1` rule: at most one of {Spread, Moneyline, Total} per `event_id` per parlay (player props on that game are still allowed under the existing 0.75 concentration cap).
- Tighten `megaLotteryScanner` in `strategies.ts` to require at least one player leg in the combo so the lottery doesn't reduce to "three team-market lines on one game".

### 5. Memory update
- Append a Core rule: "Team/game legs require a real model score; never default to constant confidence; spread legs ≥10 are dropped."
- New file `mem://logic/parlay/team-leg-intelligence` with the scoring contract above.
- Update `mem://logic/parlay/same-game-concentration` to record the new `MAX_TEAM_LEGS_PER_GAME=1` and `team_side_exposure=1` caps.

### 6. Verification
- Unit test in `supabase/functions/_shared/parlay-engine-v2/__tests__/`:
  - reject combo with two HOME spreads same team (different lines).
  - reject combo with Spread + Total on same `event_id`.
  - mega_lottery requires ≥1 player leg.
- Broadcast test: team-leg payload renders `Cleveland Guardians Spread −1.5 (+140) (vs Detroit Tigers)` instead of `Unknown player — Spread HOME −1.5`.
- Hit `parlay-engine-v2` in dry-run and confirm at least one team leg now carries a non-0.66 confidence and a non-zero edge.

### Out of scope
- No changes to the existing player-prop scoring path.
- No schema migrations beyond persisting extra leg metadata (stored inside the `legs` JSON, no DDL).
- No touching the whale engine — separate workstream.
