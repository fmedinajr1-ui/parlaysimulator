# Plan: Surgical v2 upgrades to alert explainer

Keep the v1 multi-axis verdict system (it's tunable, multi-sport, and powers the admin UI). Layer 4 targeted changes derived from the v2 spec + 7-day audit.

## 1. Add per-signal-type mute list

- Extend `alert_thresholds` schema with a `signal_mutes` row type (or a new `alert_signal_config` table keyed by `signal_type`) storing `{ muted: bool, reason: text, updated_by, updated_at }`.
- Default seed: `take_it_now` muted (audit: 2/14 = 14%). `cascade` and `velocity_spike` active.
- `buildPlayerReasoning` accepts `signal_type` in `ExplainerInput` and forces `verdict = 'NEUTRAL'` + `action = 'PASS'` + `flags: ['signal_muted']` when muted.
- Telegram admin commands: `/mute SIGNAL reason`, `/unmute SIGNAL`, `/mutes` (list).
- Admin UI: new "Signal mutes" tab in `/admin/alert-thresholds` showing toggle + reason per signal type.

## 2. Asymmetric model_edge thresholds (default retune)

- Current defaults: aligned ±0.5σ symmetric.
- New defaults from audit: `aligned_over/under = 0.3`, `against_over/under = -1.0` (deeper FADE bar matches v2's BACK_EDGE_MIN=0.2 / FADE_EDGE_MAX=-1.0 in σ-normalized space).
- Migration only updates the `ALL` default row; existing per-sport overrides are preserved.
- Existing per-side fields already in `alert_thresholds` — no schema change.

## 3. Add `action` enum to PlayerReasoning

Map verdicts + model_edge alignment into a clean enum the Telegram layer + UI can consume directly:

```text
action = 'BACK' if verdict in {STRONG, LEAN} AND model_edge != 'against'
action = 'FADE' if verdict == 'WEAK' AND model_edge == 'against'
action = 'PASS' otherwise (NEUTRAL or signal-muted or model disagrees with a STRONG)
```

- Adds `action: 'BACK' | 'FADE' | 'PASS'` to `PlayerReasoning` (non-breaking — additive field).
- `signal-alert-telegram` action ladder collapses around this enum: TAIL = ≥2 BACK legs, FADE = ≥⅔ FADE legs, REVIEW = mixed, SKIP = mostly PASS.
- Counter-read text already exists; keep it for transparency.

## 4. Append v2 recalibration playbook to memory

Add a "Recalibration triggers" section to `mem://logic/alerts/explainer-contract.md`:

```text
- BACK hit% < 75% over n≥30 → raise model_edge.aligned_* to 0.5
- FADE win% < 80% over n≥30 → lower model_edge.against_* to -1.5
- take_it_now hit% > 55% over n≥30 → unmute
- Re-run audit-verdict-backfill weekly
```

## Tests (5 required per project rule)

In `_shared/alert-explainer_test.ts`:
1. Muted signal returns NEUTRAL + action=PASS regardless of inputs.
2. STRONG verdict + model_edge aligned → action=BACK.
3. WEAK verdict + model_edge against → action=FADE.
4. STRONG verdict + model_edge against → action=PASS (model override).
5. Asymmetric thresholds: model_edge=+0.35 aligned, model_edge=-0.6 neutral (was against under symmetric ±0.5).

## Files

- `supabase/migrations/<ts>_signal_mutes.sql` — new `alert_signal_config` table + audit trigger + seed take_it_now muted; update ALL model_edge defaults.
- `supabase/functions/_shared/threshold-config.ts` — load + cache mutes alongside thresholds.
- `supabase/functions/_shared/alert-explainer.ts` — accept signal_type, apply mute, compute action, asymmetric edge cuts.
- `supabase/functions/_shared/alert-explainer_test.ts` — append 5 new tests.
- `supabase/functions/signal-alert-engine/index.ts` + `signal-alert-telegram/index.ts` — pass signal_type through; consume action enum.
- `supabase/functions/telegram-prop-scanner/index.ts` — `/mute`, `/unmute`, `/mutes` commands.
- `src/pages/admin/AlertThresholds.tsx` — "Signal mutes" tab.
- `mem/logic/alerts/explainer-contract.md` — recalibration triggers + action enum doc.

## Out of scope

- Replacing v1 verdicts with BACK/FADE/NEUTRAL (keeps audit trail intact).
- Cascade outcome grading (separate work — needs settlement on cascade rows first).
- Re-running the audit (do after 7 more days to validate cascade + new asymmetric cuts).
