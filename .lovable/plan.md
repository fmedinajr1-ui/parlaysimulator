## Problem

Two separate issues from the cascade alert in your screenshot:

1. **Miss-by-1 leak.** Picks like Okongwu O 6.5 rebounds losing by 1 (he had 6) keep ruining cascade tickets. Today the cascade engine only filters by juice-gap confidence — it has no concept of "how close is the line to the player's actual baseline?" so high-variance role players whose mean sits exactly *at* the line keep slipping in.

2. **Missing role/archetype label.** The `player_archetypes` table already classifies Onyeka as `GLASS_CLEANER`, Mitchell Robinson as `GLASS_CLEANER`, NAW as `PURE_SHOOTER`, etc. — but `signal-alert-telegram` never reads that table, so the cascade message shows zero role context. There is also no `BENCH` / `STARTER` flag anywhere yet.

---

## Fix #1 — Miss-by-1 Suppression Gate (cascade only)

Add a per-leg `miss_by_1_risk` check inside `signal-alert-engine` before a player joins a cascade group. A leg is dropped when the line sits inside a "danger band" around the player's mean given current minutes/role.

**Danger-band rule (NBA rebounds/points/assists/threes):**

```text
season_mean   = player_season_stats.last_10_avg_<stat>  (fallback: avg_<stat>)
season_std    = player_season_stats.<stat>_std_dev
distance      = |line - season_mean|
band          = max(0.6, 0.5 * season_std)

DROP from cascade if:
  side = Over  AND  line > season_mean  AND  distance < band
  side = Under AND  line < season_mean  AND  distance < band
```

In English: the alert is asking the player to clear a line that is less than half a standard deviation away from where they normally land. Those are the props that miss by 1.

Extra safety nets layered on top:

- **Volume floor:** drop legs where `last_10_avg_minutes < 22` for non-bench-confirmed players, and `< 18` minutes for bench players. Low-minute legs are the #1 source of miss-by-1.
- **Bench downgrade:** if a leg's player is tagged `ROLE_PLAYER` *or* `avg_minutes < 24`, require the band check to pass with `distance ≥ 0.75 * std` (stricter).
- **Cascade quorum tightening:** after dropping risky legs, require the cascade still has ≥ 3 distinct players. Otherwise the whole cascade is suppressed (better to skip than to publish a bad one).

All drops are logged into `metadata.dropped_legs[]` on the alert row so we can audit which legs were filtered and why.

## Fix #2 — Player Role Labels in the Cascade Message

**Step A — extend the explainer payload.** In `_shared/alert-explainer.ts`, when `buildPlayerReasoning` runs, also pull from `player_archetypes` and `player_season_stats`:

- `archetype` (e.g. `GLASS_CLEANER`, `PURE_SHOOTER`, `ROLE_PLAYER`)
- `role_tier` derived from minutes:
  - `STARTER`         if `avg_minutes ≥ 28`
  - `ROTATION`        if `22 ≤ avg_minutes < 28`
  - `BENCH`           if `avg_minutes < 22`
- `usage_note` (string): one short phrase like "12th-man big" / "starter" / "6th-man wing"

These three fields get attached to `engine_reasoning.role` on every player in `metadata.player_breakdown`.

**Step B — render them in `signal-alert-telegram`.** Inside the cascade `for (const p of rendered)` loop, prepend a role line so each player block shows:

```text
• Onyeka Okongwu  U 6.5 rebounds  conf 67%
  🎯 GLASS_CLEANER · BENCH (18.4 mpg)
  ↳ verdict / matchup / form lines (existing)
```

Emoji map (concise, mirrors `PlayerRoleBadge.tsx`):

```text
ELITE_REBOUNDER / GLASS_CLEANER / RIM_PROTECTOR  →  🛡️
PRIMARY_SCORER / SCORING_WING / SCORING_GUARD    →  ⭐
ELITE_PLAYMAKER / PLAYMAKER / COMBO_GUARD        →  🎯
PURE_SHOOTER / STRETCH_BIG                        →  🏹
DEFENSIVE_ANCHOR / TWO_WAY_WING                  →  🦅
ROLE_PLAYER                                       →  🔧
```

The role tier (STARTER / ROTATION / BENCH) is a separate suffix so you can scan at a glance which legs are bench-player legs (the highest-variance ones).

## Fix #3 — Self-audit memory rule

Save a new memory file `mem://logic/betting/cascade-miss-by-1-guard` documenting the band rule + minutes floor so future engine changes don't regress, and add a one-liner to `mem://index.md` Core: "Cascade legs must clear a `0.5 * std` band around season mean and meet minutes floors; bench players require `0.75 * std`."

---

## Files to change

- `supabase/functions/signal-alert-engine/index.ts` — add `dangerBandFilter()` helper, apply before cascade quorum check, persist `dropped_legs` in metadata.
- `supabase/functions/_shared/alert-explainer.ts` — extend `PlayerReasoning` type with `role: { archetype, role_tier, usage_note, avg_minutes }`, fetch from `player_archetypes` + `player_season_stats` (single batched query keyed by `player_name`).
- `supabase/functions/signal-alert-telegram/index.ts` — add `formatRoleLine()`, render under the player heading inside the cascade block.
- `mem://logic/betting/cascade-miss-by-1-guard` (new) + `mem://index.md` (append).

No schema changes — we're using existing tables (`player_archetypes`, `player_season_stats`).

---

## Why this works

- The **danger band** is mathematically the exact definition of "miss by 1" — a line within half a std of the mean is, by construction, the line most likely to land within ±1 of actual.
- Reading `player_archetypes` + `avg_minutes` lets you instantly see *why* a leg is risky: a `BENCH` `GLASS_CLEANER` like Okongwu playing 18 mpg should never be in a 6.5-rebound cascade unless his mean is well above 7.5.
- All work is server-side inside the existing alert pipeline — no UI changes, fully ingested by the Telegram bot you already use.