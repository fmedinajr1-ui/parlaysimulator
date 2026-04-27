## Goal

Make every signal alert (cascade first, then all engines) explain **why** each player was picked and **what they're going against** — so we can audit and tune the engines' decisions, not just see a list of names + confidence.

Today a cascade alert looks like:

```
🌊 CASCADE ALERT — NBA
Players in the cascade:
  • Jalen Duren — conf 90
  • Cade Cunningham — conf 90
  • Goga Bitadze — conf 90
```

That tells us nothing about *why*. We're going to make every player line carry its own one-glance explainer with the matchup it's running into and a smart-decision verdict.

## What "informational per player" will look like

Per-player block in cascade alerts (and inline reason in single-player alerts):

```
🌊 CASCADE ALERT — NBA  •  Pistons @ Magic  •  7:00 PM ET
Prop: Rebounds UNDER  •  6 players aligned  •  avg conf 90%

Why the engine flagged this side:
• Magic allow 4th-fewest rebounds to opposing C's (L15)
• Game total 218.5 → bottom-10 pace projection
• No injury swing in MIA frontcourt (Carter Jr active)

Players in cascade (engine reasoning each):
  • Jalen Duren  U 9.5  conf 90
     ↳ vs ORL C-defense rank #4  •  L10 hit rate U 9.5: 7/10
     ↳ Juice gap +28 (book hammering Under)  •  PVS C-tier
     ↳ Verdict: STRONG — defense + price + form all align ✅

  • Cade Cunningham  U 5.5  conf 90
     ↳ vs ORL PG-defense rank #11 (neutral)
     ↳ L10 hit rate U 5.5: 6/10  •  pace -3% vs season
     ↳ Verdict: LEAN — price-driven, matchup neutral ⚠️

  • Goga Bitadze  U 3.5  conf 90
     ↳ ⚠️ Bench role: 14 min/g — volatility gate flagged
     ↳ vs DET C-defense rank #22 (weak)
     ↳ Verdict: WEAK — engine likely overconfident ❌
```

Three things change vs. today:
1. **Group-level "why"** at the top of each cascade — opponent context shared across all the players.
2. **Per-player explainer** — defensive rank for that player's position, L10 hit rate at that line, juice/PVS/minutes flags.
3. **Smart-decision verdict** per player (`STRONG / LEAN / WEAK`) so we can see at a glance which legs are *really* driving the cascade and which are noise inflating the player count.

## Where the data comes from (already in DB, just not joined)

| Field shown | Source |
|---|---|
| Opponent defensive rank vs position | `matchup_intelligence.position_defense_rank`, `opponent_defensive_rank` |
| Stat allowed by opponent | `matchup_intelligence.opponent_stat_allowed` |
| Game script / blowout risk | `matchup_intelligence.game_script`, `blowout_risk` |
| L10 hit rate at line | `nba_player_game_logs` / `mlb_player_game_logs` (count vs `current_line`) |
| PVS tier + sub-scores | `unified_props.pvs_tier`, `pvs_minutes_score`, `pvs_matchup_score` |
| Juice gap | already computed in `signal-alert-engine` (kept as-is) |
| Minutes volatility flag | `unified_props.pvs_minutes_score` < threshold |
| Injury context | `injury_reports` / `nba_injury_reports` for the opponent's relevant position |
| Game total / pace | `unified_props.true_line` not useful here — use `matchup_intelligence.vegas_total` |

No new tables. Pure cross-reference.

## Bidirectional check + verdict logic

Each player gets scored against the same direction the engine picked, on five axes:

1. **Opponent defense alignment** — does the opponent's positional defense rank push the prop *the way the engine called it*? (Under + top-10 defense = aligned)
2. **L10 form alignment** — does the player's last-10 hit rate at this line agree with the side?
3. **Pace / game-script alignment** — does game total push the side?
4. **Juice alignment** — is the price gap consistent with the side?
5. **Volatility / role** — minutes stable enough to trust?

Aligned axes → `STRONG` (≥4), `LEAN` (3), `WEAK` (≤2). The verdict goes back into `metadata.player_breakdown[i].engine_reasoning` so it's queryable and we can build an admin "why was this leg in the cascade?" view later.

## Smart-decision feedback loop

The same `engine_reasoning` block gets persisted on `fanduel_prediction_alerts.metadata` so we can:
- Settle alerts and ask: did `STRONG`-tagged legs hit more than `WEAK` ones?
- If `WEAK` legs are inflating cascade size, raise the per-player floor to require ≥`LEAN` to count toward `CASCADE_MIN_PLAYERS`.
- This gives us a measurable knob to tune the engine instead of guessing.

## Engines covered

We'll apply the same explainer + bidirectional verdict pattern to every engine that writes to `fanduel_prediction_alerts`:

- `signal-alert-engine` → cascade, take_it_now, velocity_spike (the priority — that's where 100+ alerts/wk come from)
- `mlb-over-tracker` → sb_over_l10, hr_power_over, price_drift (MLB matchup data: pitcher quality + park factor + L10)

Other engines that *don't* hit this table today (`fanduel-boost-scanner`, `team-bets-scoring-engine`, etc.) will get the same `engine_reasoning` shape on their own outputs in a follow-up so the schema is consistent across the system.

## Files / changes

### New
- `supabase/functions/_shared/alert-explainer.ts` — pure helper that, given a `(player_name, prop_type, side, line, event_id, sport)`, returns:
  ```ts
  {
    matchup: { defenseRank, statAllowed, gameScript, vegasTotal, blowoutRisk },
    form:    { l10Hits, l10Total, hitRate },
    role:    { minutesScore, minutesFlag },
    pvs:     { tier, matchupScore, paceScore },
    injuries:{ relevant: InjuryNote[] },
    alignment: { defense, form, pace, juice, role }, // each: 'aligned' | 'neutral' | 'against'
    verdict:  'STRONG' | 'LEAN' | 'WEAK',
    headline: string,  // one-line "why" for the player
  }
  ```
  Reads only — joins the tables listed above. No writes.

### Modified
- `supabase/functions/signal-alert-engine/index.ts` — for each prop in a cascade group, call the explainer and attach to `player_breakdown[i].engine_reasoning`. Also produce a group-level explainer (shared opponent context, game total, headline injuries) stored at `metadata.group_reasoning`. Same for `take_it_now` (single-player, becomes `metadata.engine_reasoning`) and `velocity_spike`.
- `supabase/functions/signal-alert-telegram/index.ts` — render the new `engine_reasoning` blocks in `formatAlert`. Cascade gets the multi-line per-player layout shown above; take-it-now/velocity get a 2-line "why + matchup" inline.
- `supabase/functions/mlb-over-tracker/index.ts` — same explainer call (MLB variant uses `mlb_player_game_logs` for L10 and pitcher matchup data already available).

### Memory
- New `mem://logic/alerts/explainer-contract.md` documenting the `engine_reasoning` shape so all future engines emit it consistently.

## Telegram length safety

Cascade messages can balloon. We will:
- Cap rendered players at **5** in the message body, then "+N more — see dashboard".
- Hard cap message at ~3,500 chars (Telegram limit is 4,096).
- All players still stored in `metadata.player_breakdown` for audit.

## Out of scope (this pass)

- New UI surface for the reasoning blocks (will land in a follow-up once the data shape is proven).
- Auto-tuning thresholds based on `STRONG/LEAN/WEAK` hit rates — the data needs to accumulate first.
- Non-`fanduel_prediction_alerts` engines — same shape applied next pass once this one is verified.

## Verification

Per the project's testing rule, before considering this done we'll run **5 independent checks**:
1. Trigger `signal-alert-engine` on a frozen slate; confirm every cascade row has `metadata.player_breakdown[i].engine_reasoning` and `metadata.group_reasoning`.
2. Render the alert via `signal-alert-telegram` in dry-run mode and confirm it stays under the char cap with 8+ players.
3. Spot-check 3 real cascade alerts: do the defense ranks + L10 hit rates pulled match what's in `matchup_intelligence` / `*_player_game_logs` directly?
4. Verify `STRONG/LEAN/WEAK` verdict logic on hand-built fixtures (one of each).
5. Confirm `mlb-over-tracker` SB and HR alerts get the same `engine_reasoning` block populated end-to-end.
