---
name: Alert engine_reasoning contract v1
description: Per-player reasoning + group reasoning shape attached to fanduel_prediction_alerts.metadata for cascade/take_it_now/velocity_spike (and future engines)
type: feature
---

All signal generators write `metadata.engine_reasoning` (single-player alerts) or `metadata.player_breakdown[i].engine_reasoning` + `metadata.group_reasoning` (cascade) using the v1 shape from `supabase/functions/_shared/alert-explainer.ts`.

**Per-player block (`PlayerReasoning`)** — joins `matchup_intelligence`, `unified_props` (PVS sub-scores), `*_player_game_logs` (L10), `injury_reports`. Five alignment axes: `defense / form / pace / juice / role`, each `'aligned'|'neutral'|'against'|'no_data'`. Verdict mapping:
- STRONG: aligned_count ≥ 4
- WEAK: against_count ≥ 3 OR aligned_count ≤ 1
- LEAN: otherwise

**Group block (`GroupReasoning`)** — shared opponent + vegas total + injury list + 1–3 headline bullets.

**Cascade metadata also carries** `verdict_counts: { strong, lean, weak }` so we can audit which cascades are real vs. inflated by WEAK legs.

Telegram formatter (`signal-alert-telegram`) sorts cascade players STRONG → LEAN → WEAK, caps at 5 rendered (rest in metadata), enforces 3500-char message ceiling.

Failures in the explainer are non-fatal — alert still fires with `engine_reasoning: null`.

When adding a new alert generator, call `buildPlayerReasoning(supabase, input)` and stash the result under the same key. Do not invent a new shape.
