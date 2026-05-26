---
name: prop-alert-verifier
description: Deep-research second-opinion agent that soft-tags every inbound prop alert before the parlay engine consumes it.
type: feature
---

## Verifier Agent

Every alert inserted into `fanduel_prediction_alerts`, `sharp_signals`, `extreme_movement_alerts`, or `market_signals` triggers `prop-alert-verifier`:

1. **Research** — Perplexity `sonar-deep-research`, sport-tailored prompt (NBA defensive ranks; MLB weather + pitcher; NHL goalie/lines).
2. **Judge** — `openai/gpt-5` via Lovable AI Gateway returns strict JSON `{verdict, confidence, reasoning, flags}`. Verdict ∈ APPROVE | CAUTION | REJECT.
3. **Write** — row in `prop_alert_verdicts` (unique per source_table+alert_id); patches source alert's `metadata.verifier = {verdict, multiplier, reasoning, flags}`.

**Soft tag only.** Parlay engine reads `metadata.verifier.multiplier` in `parlay-engine-v2/scoring.ts` and multiplies `leg.confidence` by it (clamped 0.30–1.20). No hard block.

### Multiplier formula
- APPROVE: `1 + min(0.15, (conf-60)/400)` — small boost.
- CAUTION: `0.85 - min(0.20, (conf-50)/250)` — mid haircut.
- REJECT: `max(0.30, 0.55 - min(0.25, (conf-50)/200))` — floor 0.30, never zero.

### Triggers
- Postgres `AFTER INSERT` on each of the 4 alert tables → `net.http_post` to `prop-alert-verifier` (fire-and-forget).
- Cron `prop-alert-verifier-sweep-5m` every 5 min: `{mode:'sweep', since_minutes:30}` as safety net.

### Guardrails
- Dedupe: skip if a verdict already exists for the same `(player, prop, side)` within 2h — cached verdict re-stamped onto the new alert.
- Daily cap: 300 verdicts/day tracked in `prop_alert_verifier_daily_cost`. Over cap → fall back to `google/gemini-2.5-flash` and skip Perplexity (`flags: ['DEGRADED']`).
- Per-call timeouts: 75s research, 45s judge. Judge failure writes CAUTION + `JUDGE_ERROR` flag.

### Admin UI
`/admin/verifier` — last 200 verdicts, sport/verdict filters, KPI counts, re-verify button.

### Secrets
`PERPLEXITY_API_KEY`, `LOVABLE_API_KEY` (both already configured).

### Tests (5)
`supabase/functions/prop-alert-verifier/index_test.ts` — multiplier formula, NBA prompt, MLB prompt swap, all 6 required headings, source_table coverage.