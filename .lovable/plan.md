# Plan: 7-Day Verdict Audit Backfill

## Goal
Replay the new explainer logic (NEUTRAL verdict + model_edge axis) against the last 7 days of `fanduel_prediction_alerts` (cascade / take_it_now / velocity_spike) and score each verdict bucket against actual settled outcomes. This validates whether NEUTRAL is correctly carving out fadeable picks from non-fadeable ones, and whether `model_edge` is a leading indicator vs the other 5 axes.

## Data reality check
- Last 7d: 985 NBA alerts (697 cascade, plus take_it_now / velocity_spike)
- `fanduel_prediction_alerts.was_correct` is currently **NULL for all 985 rows** — no settlement has run on this window
- `settlement_records` has 0 rows in the same window
- MLB / NHL / NFL: 0 alerts in window (NBA-only audit)

So the audit must do two things, not one:
1. **Settle the alerts** by joining each alert's `(player_name, prop_type, event_id, prediction)` to the relevant `*_player_game_logs` row using `commence_time`. Compute `was_correct` locally without writing back to the table.
2. **Re-run the explainer** against each historical alert using current thresholds, then bucket by verdict.

## Deliverable
A new edge function `audit-verdict-backfill` (POST, admin-only via shared secret header) that returns a JSON report and writes a CSV to `/mnt/documents/verdict_audit_<date>.csv`. Also exposed in the existing `/admin/alert-thresholds` page as a "Run 7-Day Audit" button.

## Output report shape
```text
Window: 2026-04-27 → 2026-05-04  (NBA, 985 alerts, X settleable)

By verdict (alerted side hit %):
  STRONG    n=___   hit=__%    edge vs baseline +__pp
  LEAN      n=___   hit=__%    edge vs baseline +__pp
  NEUTRAL   n=___   hit=__%    edge vs baseline +__pp   ← should be ~50%, NOT a fade
  WEAK      n=___   hit=__%    flip-side hit=__%        ← flip should win

By signal_type × verdict:
  cascade / STRONG  n=__ hit=__%   ...

Axis-isolated lift (alerts where ONLY this axis flipped the verdict):
  model_edge → +__pp lift on STRONG, ___ pp on WEAK flip
  defense    → ...
  form       → ...
  pace       → ...
  juice      → ...
  role       → ...

Decisions to make:
  - Is NEUTRAL hit% within [45%, 55%]?  (yes = correct carve-out; no = retune)
  - Does WEAK flip-side beat 52%?       (yes = explainer fade is real)
  - Does model_edge alone shift verdict on >5% of alerts?
```

## Algorithm
1. Pull `fanduel_prediction_alerts` for the last 7 days where `signal_type IN ('cascade','take_it_now','velocity_spike')` and `commence_time < now()` (game must have started/finished).
2. For each alert:
   - Parse `prediction` → `(side, line)` (already split in `metadata.line` / `metadata.side` for newer rows; fall back to regex).
   - Look up actual stat from `nba_player_game_logs` (or MLB equivalent) keyed by `player_name` + `commence_time::date`.
   - Compute `was_correct` = `(actual > line) === (side === 'Over')`. Mark as `unsettleable` if no log row found.
   - Re-run `buildPlayerReasoning(supabase, {...})` with current thresholds → get verdict + axis alignment.
3. Aggregate into the report buckets above.
4. Write CSV with one row per alert: `id, player, prop, side, line, actual, was_correct, verdict, aligned_count, against_count, model_edge_value, alignment_defense, ...`.
5. Return JSON summary.

## Files
- `supabase/functions/audit-verdict-backfill/index.ts` — new edge function. Admin-gated via `x-admin-secret` header (matches existing pattern in `telegram-prop-scanner`). Reuses `buildPlayerReasoning` from `_shared/alert-explainer.ts`.
- `supabase/functions/audit-verdict-backfill/index_test.ts` — Deno test with 5 fixtures: STRONG-hit, LEAN-hit, NEUTRAL-near-50, WEAK-flip-wins, unsettleable. Required by the project's 5-test rule.
- `src/pages/admin/AlertThresholds.tsx` — add "Run 7-Day Audit" button + result panel rendering the report.
- `mem/logic/alerts/explainer-contract.md` — append the audit's interpretation rules (NEUTRAL band, WEAK-flip threshold, model_edge isolation).

## Technical details
- Run synchronously; 985 alerts × ~4 supabase reads each ≈ 4k reads. Batch unified_props/matchup_intelligence lookups by `(event_id)` to keep it under 30s. If timeout becomes a concern, accept a `?days=N` query param and chunk.
- Do NOT write back to `fanduel_prediction_alerts.was_correct` — the production settlement orchestrator owns that column; this audit is read-only.
- Sport scope: NBA only based on current data; code generalises to MLB/NHL/NFL via the existing `pickPropFamily` switch so it works once those alerts return.
- Eastern Time normalisation when matching `commence_time::date` to `game_date` (per Core memory rule).
- Skip rows where `metadata` lacks both `line` and a parseable prediction string — count them as `unparseable` in the report.

## Out of scope
- Backfilling `was_correct` into the production table.
- Retuning thresholds automatically — the audit only reports; tuning stays manual via the existing `/set` Telegram command and admin UI.

Ready to implement on approval.
