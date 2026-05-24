## Leg Verification Layer

Add a shared `validate_leg` / `validate_ticket` gate that runs on every candidate before it enters a parlay. Hard fails reject, soft fails apply a confidence haircut.

### 1. New shared module: `supabase/functions/_shared/leg-validator.ts`

Single source of truth, used by all generators.

```text
validateLeg(leg, ctx) -> { hardFails: string[], softFails: string[], haircut: number }
validateTicket(legs)  -> { hardFails: string[] }
```

Where `ctx` carries the day's schedule, rosters, lineups, and team records, fetched once per run and passed in.

**Hard checks (reject leg):**
1. `team` ∈ canonical whitelist (30 MLB / 32 NHL / 30 NBA / 30 NCAAF subset / etc). Reject partial/truncated names like `"Colorado A…alanche"`.
2. Venue alignment: `schedule[game_id].home_team === leg.team` when `home_away==="HOME"`, mirror for AWAY.
3. `game.start_time > now() + 5min`.
4. Player on active roster (props only): reuse existing `_shared/rosters.ts` lookup; `rosterTeam(player) === leg.team`.
5. Spread direction matches Fav/Dog tag: `tag==="Fav"` ⇒ `spread < 0`.

**Cross-leg hard check (validateTicket):**
6. No two legs share `game_id`.

**Soft checks (record reason, apply haircut to `safety` / `model_edge`):**
7. Price-vs-strength: `team.win_pct < 0.450 && american_odds < -150` → 25% haircut, flag `weak_team_heavy_fav`.
8. Lineup not confirmed within T-120min → 30% haircut; at T-30min still missing → reject.

### 2. Canonical team whitelist: `supabase/functions/_shared/canonical-teams.ts`

Hardcoded arrays per sport plus a `matchCanonicalTeam(sport, raw)` helper that normalizes (lowercase, strip punctuation, collapse whitespace) and requires an exact match — no substring/prefix matching. Returns `null` on truncated strings, which trips hard check #1.

### 3. Schedule + lineup context loaders

- `loadDailySchedule(sport, dateET)` → reuses ESPN scoreboard already used by `cross-sport-parlay-settler` (`?dates=YYYYMMDD`). Returns `Map<game_id, {home_team, away_team, start_time_utc}>`.
- `loadConfirmedLineups(sport, dateET)` → MLB/NHL only; queries existing lineup tables if present, otherwise stub returning empty set (soft check #8 then just haircuts).
- `loadTeamRecords(sport)` → existing standings table or ESPN standings API.

Loaders are cached per invocation, passed to validator via `ctx`.

### 4. Wire into generators

Insert validation between candidate prep and ticket assembly in:
- `cross-sport-parlay-generator/index.ts` — before `buildSlot()` greedy loop
- `parlay-engine-v2/index.ts` (and `_shared/parlay-engine-v2/generator.ts` filter step)
- `nuke-build-parlays/index.ts`
- `daily-whale-parlay-generator/index.ts`
- `ocr-pool-build-parlays/index.ts`

Pattern in each:
```text
const ctx = await buildValidationContext(sports, dateET);
const survivors = [];
for (const leg of candidates) {
  const v = validateLeg(leg, ctx);
  if (v.hardFails.length) { bump(rejection, v.hardFails[0]); continue; }
  if (v.softFails.length) leg.safety *= (1 - v.haircut);
  survivors.push(leg);
}
// ...build tickets from survivors...
const tv = validateTicket(ticket.legs);
if (tv.hardFails.length) { reject; regenerate; }
```

Regenerate up to existing `max_attempts`; if under minimum legs, skip the ticket.

### 5. Tests: `supabase/functions/_shared/leg-validator_test.ts`

5 deterministic tests covering:
- Truncated team name rejected (`"Colorado A…alanche"`).
- Rangers labeled HOME when schedule says AWAY → hard fail.
- Started game rejected.
- Two legs same game → ticket hard fail.
- Weak team -198 fav → soft fail with 25% haircut applied.

Per project rule (5 manual verifications before deploy), I'll also run `supabase--test_edge_functions` and dry-run one generator after wiring.

### 6. Upstream join audit (the real bug)

Before/after the validator lands I'll grep how generators join odds rows to schedule rows. If the join key is team-name based rather than `event_id`/`game_id`, that's the actual source of "Rangers-Angels" mismatches. I'll patch the join to `event_id` where the column exists (`unified_props.event_id` already does) and flag any generator still doing name-based joins as a follow-up. The validator stays in either way as defense-in-depth.

### Memory updates

Add `mem://logic/parlay/leg-validation-gate.md` with the hard/soft check list and link it from `mem://index.md` Core.

### Files touched

- new: `supabase/functions/_shared/leg-validator.ts`
- new: `supabase/functions/_shared/canonical-teams.ts`
- new: `supabase/functions/_shared/leg-validator_test.ts`
- edited: 5 generator `index.ts` files above
- new: `mem://logic/parlay/leg-validation-gate.md`, updated `mem://index.md`

No DB migrations needed — validator is pure logic over existing tables.