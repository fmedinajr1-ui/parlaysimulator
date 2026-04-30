
# Court.Edge — Pick Drilldown + Player Roles

Two tightly-related additions:

1. A **shareable per-pick drilldown** message on Telegram showing every projection input that produced the verdict.
2. A **player role / playstyle** classifier (tennis equivalent of NBA "role") that explains *why* a player is weaker on a given night and is fed into both the projection and the drilldown.

Everything stays headless. No UI.

---

## 1. Player roles (tennis playstyle archetypes)

Roles are the tennis analogue of NBA role tags. We classify each player into one archetype and tag *why this matters tonight* against the surface, opponent, weather, and indoor flag.

Archetypes:
- `big_server` — short points, holds easily → fewer breaks → tighter sets, higher chance of tiebreaks
- `aggressive_baseliner` — first-strike tennis, surface-sensitive
- `counter_puncher` — long rallies, thrives on slow courts
- `clay_grinder` — clay specialist, struggles on fast/grass
- `serve_and_volleyer` — rare, grass/indoor friendly
- `all_court` — balanced, no strong tilt
- `unknown` — fallback when we have no signal

Each role gets a small projection nudge and a human-readable "why weaker tonight" reason when the matchup context is unfavourable. Examples:
- `big_server` on slow clay outdoors → `+0.4` games (more breaks, longer sets) and reason "*Big serve neutralised on slow clay*"
- `clay_grinder` on grass → `-0.6` games and reason "*Baseline grinder exposed on fast grass*"
- `counter_puncher` indoors fast hard → `-0.3` and "*No time to reset on quick indoor courts*"
- `serve_and_volleyer` on clay → `-0.5` and "*S&V style stalls on clay*"
- High wind (>15mph) + `big_server` → `-0.3` and "*Wind disrupts serve toss*"
- Cold (<50°F) + `aggressive_baseliner` → `-0.2` and "*Cold ball kills aggressive baseline winners*"

These nudges are **additive to the existing surface/weather/indoor adjustments** — they're player-specific modifiers, not replacements.

### Source of role data

Two-tier resolution, cached:
1. **Static seed table** — a curated `court_edge_player_roles` table of ~150 top ATP/WTA players with `archetype`, `serve_tier` (elite/good/avg), `clay_score`, `grass_score`, `hard_score`, and a free-text `notes` field. This handles the bulk of slates.
2. **Heuristic fallback** — when a player is missing from the seed table, infer from the L3 raw scores already scraped:
   - average set score ≥ `7-6`-ish (high game count per set) → likely `big_server`
   - tiebreak frequency in L3 > 33% → `big_server`
   - average match length > 26 games on clay → `counter_puncher` or `clay_grinder`
   - default → `all_court`
3. Cache the resolved role per player in `court_edge_l3_cache` (extra column) so we don't recompute every run.

---

## 2. Pick drilldown message

For each non-PASS pick (capped at the top N), the orchestrator builds a standalone, shareable Telegram message — separate from the digest — that lists *every* projection input. The digest stays as the at-a-glance board; the drilldown is the deep-dive that users can forward.

### Format (Markdown)

```text
🎾 COURT.EDGE DRILLDOWN
[Player A] vs [Player B] — Match Total Games
Tournament: Roland Garros · Clay · Bo5 · Outdoor · 78°F

🟢 STRONG OVER  ·  line 22.5  proj 24.10  edge +7.1%

📐 Inputs
• L3 [Player A]: 24, 21, 26  (wL3 23.4)
• L3 [Player B]: 22, 25, 20  (wL3 22.6)
• Base L3 (avg): 23.00
• Surface mult (clay): ×1.08  → +1.84
• Sets mult (Bo5): ×1.70 (applied)
• Spread adj: -0.42  (ml -180 / +150 → -2.5·|Δp|)
• Weather adj: +0.30  (78°F warm, 8mph wind, 45%RH)
• Indoor adj: 0.00
• Role adj [A]: +0.40  (Big server neutralised on slow clay)
• Role adj [B]: 0.00  (All-court, no tilt)
─────────────────
Projection: 24.10

👥 Roles
• [Player A]: Big server · elite serve · clay 0.45
   ⚠️ Big serve neutralised on slow clay
• [Player B]: All-court · good serve · clay 0.78

📚 Sources: OddsAPI · TennisAbstract L3 · Open-Meteo
Run a3f1c2··  share-id #pk_8821
```

For PrizePicks player-total picks the layout is the same but shows only one player's role plus the opponent's role for context, and the projection line is split (`match proj 24.10 → player share 12.05`).

### Delivery

- Sent as a *separate* Telegram message **after** the digest, one message per top pick (cap = 5 by default, configurable).
- Each drilldown carries a `reference_key` like `court_edge_drilldown:<pick_id>` so we can later thread reactions/feedback.
- Re-uses `bot-send-telegram` (already chunks at 3.8K chars) — drilldowns are small (~600 chars) so no chunking concern.

---

## 3. Persistence

- New table `court_edge_player_roles` (admin RLS) storing static seeds.
- `court_edge_picks` gets new columns: `role_home`, `role_away`, `role_adj_home`, `role_adj_away`, `role_reasons jsonb`, `drilldown_text text`. The full drilldown markdown is stored on the pick row so it's reproducible without re-running the engine.
- `court_edge_l3_cache` gets `inferred_role text` to memoise heuristic classification.

---

## 4. Files to touch / create

Create:
- `supabase/functions/_shared/court-edge-roles.ts` — archetype enum, static seed loader, heuristic classifier, `roleAdjustment(role, ctx)` returning `{adj_games, reason | null}`.
- `supabase/functions/_shared/court-edge-roles_test.ts` — 5 unit tests (each archetype × representative context).
- `supabase/functions/_shared/court-edge-drilldown.ts` — `buildDrilldown(pick, breakdown, roles, weather, tournament)` returning the markdown string. Pure function, easy to test.
- `supabase/migrations/<ts>_court_edge_roles.sql` — new table + new columns + seed inserts (~150 players, admin-only RLS).

Edit:
- `supabase/functions/_shared/court-edge-projection.ts` — extend `ProjectionInput` with `role_home?`, `role_away?` and add `role_adj_home`, `role_adj_away`, `role_reason_home`, `role_reason_away` to the breakdown. Sum into `projection`.
- `supabase/functions/court-edge-run/index.ts` — load roles for every player in the slate, pass into `project()`, persist new fields, build drilldowns for top non-PASS picks, send each via `bot-send-telegram` after the digest.
- `supabase/functions/court-edge-scrape-l3/index.ts` — write `inferred_role` back to cache when seed table miss.

---

## 5. Validation (5 mandatory tests, per project rule)

1. `roleAdjustment("big_server", {surface:"clay", indoor:false, wind:5})` returns `+0.4` with the slow-clay reason.
2. `roleAdjustment("clay_grinder", {surface:"grass"})` returns `-0.6` with the grass-exposed reason.
3. Projection with both roles set vs. both roles `unknown` differs by exactly the sum of `role_adj_home + role_adj_away` (no double-counting against surface mult).
4. Drilldown markdown contains every input line: L3, base, surface, sets, spread, weather, indoor, both role adjustments, final projection, edge.
5. Heuristic classifier given three L3 scores averaging `7-6, 7-6, 7-5` returns `big_server`; given `6-3, 6-2, 6-4` returns `all_court`.

---

## 6. Out of scope for this round

- Live in-match role re-classification.
- ML-trained role inference (we use simple seed + heuristic for now).
- A UI for editing the role table — admins seed it via SQL.
- Doubles roles.

After approval I will run the migration, deploy the new shared modules + edge function changes, hit `court-edge-run` once manually to verify a real digest + drilldown lands in Telegram, and report back.
