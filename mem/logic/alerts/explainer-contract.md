---
name: Alert engine_reasoning contract v1
description: Per-player reasoning + group reasoning shape attached to fanduel_prediction_alerts.metadata for cascade/take_it_now/velocity_spike (and future engines)
type: feature
---

All signal generators write `metadata.engine_reasoning` (single-player alerts) or `metadata.player_breakdown[i].engine_reasoning` + `metadata.group_reasoning` (cascade) using the v1 shape from `supabase/functions/_shared/alert-explainer.ts`.

**Per-player block (`PlayerReasoning`)** — joins `matchup_intelligence`, `unified_props` (PVS sub-scores), `*_player_game_logs` (L10, mean, std), `events` (opponent fallback), `injury_reports`. **Six** alignment axes: `defense / form / pace / juice / role / model_edge`, each `'aligned'|'neutral'|'against'|'no_data'`. `model_edge` = signed `(L10 mean − line) / std` for the alerted side; ≥+0.5σ aligned, ≤−0.5σ against. Verdict mapping (v2):
- STRONG: aligned ≥ 3 AND against ≤ 1
- LEAN: aligned ≥ 2 AND against ≤ 1
- WEAK: against ≥ 3, OR (known ≥ 4 AND aligned == 0)
- NEUTRAL: everything else (thin data — explicitly NOT a fade signal)

Relaxed thresholds vs v1: defense 20/12 (was 22/10), form 0.55/0.25 (was 0.6/0.3), pace 220/213 NBA (was 225/215), juice 20 (was 30).

`PlayerReasoning` now also carries `against_count`, `known_count`, and `model_edge_value` so downstream can audit and build counter-reads.

**Group block (`GroupReasoning`)** — shared opponent + vegas total + injury list + 1–3 headline bullets.

**Cascade metadata also carries** `verdict_counts: { strong, lean, neutral, weak }` so we can audit which cascades are real vs. inflated by WEAK legs.

**Telegram action ladder (v2)** in `signal-alert-telegram`:
- TAIL — `strong ≥ 2` OR (`strong ≥ 1` AND `strong+lean ≥ total−1` AND `weak == 0`)
- TAIL (small) — `strong ≥ 1` AND `weak ≤ 1`
- FADE — only when `model_edge: against ≥ ⅔ legs` AND `defense: against ≥ ½ legs` AND `weak ≥ total−1` (raised bar so FADE requires our own model to disagree, not just price + cold L10)
- REVIEW (lean side) — model OR form agrees with alerted side on ≥ ½ legs but verdicts thin → half stake
- SKIP — mostly WEAK/NEUTRAL with no model signal
- For every non-TAIL action a `buildCounterRead` line is appended so the user always sees the opposite case before flipping

Telegram formatter (`signal-alert-telegram`) sorts cascade players STRONG → LEAN → WEAK, caps at 5 rendered (rest in metadata), enforces 3500-char message ceiling.

Failures in the explainer are non-fatal — alert still fires with `engine_reasoning: null`.

When adding a new alert generator, call `buildPlayerReasoning(supabase, input)` and stash the result under the same key. Do not invent a new shape.

**v2 additions (2026-05-04):**
- `PlayerReasoning` carries `action: 'BACK' | 'FADE' | 'PASS'` derived from verdict + model_edge alignment. BACK = bet alerted side; FADE = bet opposite; PASS = skip. STRONG/LEAN with `model_edge: against` collapses to PASS (model overrides multi-axis vote).
- `ExplainerInput.signal_type` is honored. If `alert_signal_config.muted=true` for that signal, explainer short-circuits to `verdict: NEUTRAL`, `action: PASS`, `signal_muted: true`, `flags: ['signal_muted']` and skips DB reads.
- Default seed: `take_it_now` muted (audit: 2/14 = 14%). `cascade` + `velocity_spike` active.
- Default `model_edge` thresholds retuned asymmetric per audit: `aligned ±0.3σ`, `against ±-1.0σ` (was symmetric ±0.5σ). FADE bar deliberately deeper than BACK bar.

**Recalibration triggers (run audit-verdict-backfill weekly):**
- BACK bucket hit% < 75% over n≥30 → raise `model_edge.aligned_*` to 0.5 via `/set ALL model_edge aligned_over 0.5`
- FADE bucket fade-win% < 80% over n≥30 → lower `model_edge.against_*` to -1.5
- `take_it_now` hit% > 55% over n≥30 → `/unmute take_it_now`
- Cascade: needs settlement on cascade rows before re-tuning
