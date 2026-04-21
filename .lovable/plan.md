

## Test result + plan to actually flip alerts to ParlayFarm format

### Test verdict — they are NOT in the new format

I checked `bot_message_log` for the last 8 sent messages. Every single one is still the **old format**:

```
🧠 *FanDuel Behavior*
12 signals — 🔥0 🎯0 ⚡12 ...
— *VELOCITY SPIKES (12)* —
⚡ *VELOCITY* [🔴 LIVE] — NBA
James Harden POINTS
Line dropping: 27.5 → 25.5 ...
```

The spec calls for:

```
🐕 *SHARP STEAM* · NBA · 🔴 LIVE
━━━━━━━━━━━━━━━━━━━━━━━
*James Harden* · POINTS
_FanDuel_

`Line        27.5  →  `*`25.5`*` ↓`
`Speed       12/hr · 10 min`
`Confidence  95%   ██████████`
`Play        `*`UNDER 25.5`*

🐾 _Line dropped hard. Sharps are on the under._
```

### Root cause

`fanduel-behavior-analyzer` (the loudest generator — fires every 30 min and produces these digests) hand-builds its own `⚡ VELOCITY` blocks at lines 1804–1864, bundles them under `🧠 *FanDuel Behavior*` at line 2102, and sends with `parse_mode: "Markdown"` + `admin_only: true`.

It **bypasses** the new ParlayFarm pipeline because:
1. It passes `message:` directly → compat shim skipped.
2. It sets `admin_only: true` → batching/buffering skipped.
3. It uses `parse_mode: "Markdown"` (not v2) → renderers never invoked.
4. `enrichLegacyAlert()` requires `body.type` set (it isn't here).

Same pattern: `fanduel-prediction-alerts`, `accuracy-report`, every `🎯 *PERFECT LINE DETECTED*` digest. The new `parlayfarm-format.ts` is wired up but *nothing actually calls it*.

### Fix plan

**Part 1 — Migrate `fanduel-behavior-analyzer` to ParlayFarm renderers**

Replace the inline string-building block (lines 1800–2020) with calls to `renderSharpSteam()` / `renderTrapFlag()` / `renderRLM()` / `renderCascade()` from `parlayfarm-format.ts`. Map alert types:

| In-memory `a.type` | ParlayFarm renderer |
|---|---|
| `velocity_spike`, `live_velocity_spike` | `renderSharpSteam` |
| `line_about_to_move`, `live_line_about_to_move` | `renderSharpSteam` (state=PREGAME) |
| `cascade`, `live_cascade` | new `renderCascade` (add to format file) |
| `snapback` (take_it_now) | `renderSharpSteam` with snapback flag |
| `correlated_movement`, `team_news_shift` | new `renderCorrelatedMove` (add) |
| trap_warning flag set | `renderTrapFlag` |
| RLM detected | `renderRLM` |

Each alert is sent as **its own MarkdownV2 message** with the `pick_id` field set so `bot-send-telegram` auto-attaches the Run/Fade/Scan/Mute keyboard. The "more than 3 in 60s" rule then triggers `renderBatchDigest()` automatically — exactly like the spec wants.

Drop the `🧠 *FanDuel Behavior*` digest header entirely. Replaced by the sticky channel header (#8) which already shows the rolling 60-min count.

**Part 2 — Force MarkdownV2 in dispatcher**

`bot-send-telegram` defaults to `parse_mode: "Markdown"` (line 289, 309). Change default to `"MarkdownV2"` since every ParlayFarm renderer outputs v2. Existing v1-Markdown callers (settlement narratives, dawn brief) keep working because they pass `parse_mode` explicitly.

**Part 3 — Migrate the other big chatters**

- `fanduel-prediction-alerts` — same treatment: per-alert `renderSharpSteam` instead of `🎯 *PERFECT LINE DETECTED*` blocks.
- `pp-pick-broadcaster` and `bot-curated-pipeline` (whichever produces the `🔵 *STRONG EDGE*` and `🎯 *Perfect Line Alerts*` digests).

**Part 4 — Add missing renderers**

`renderCascade()` and `renderCorrelatedMove()` aren't in `parlayfarm-format.ts` yet. Add them following the same pattern (header + divider + monospace aligned block + reasoning footer + buttons via `Buttons.tail/fade/fullScan/mutePlayer`).

**Part 5 — Verify**

After deploy:
1. Manually invoke `fanduel-behavior-analyzer` (`supabase--curl_edge_functions`).
2. Re-query `bot_message_log` and confirm new rows match the spec exactly (`🐕 *SHARP STEAM*` header, monospace block, ParlayFarm footer).
3. Trigger >3 alerts in 60s and confirm the buffer + `telegram-batch-flusher` produce a digest.

### Files to edit

- `supabase/functions/fanduel-behavior-analyzer/index.ts` — gut the formatter (lines 1800–2105), call ParlayFarm renderers, send one message per alert with `pick_id`
- `supabase/functions/fanduel-prediction-alerts/index.ts` — same migration
- `supabase/functions/pp-pick-broadcaster/index.ts` (and any other digest producers) — same
- `supabase/functions/bot-send-telegram/index.ts` — flip default `parse_mode` to `MarkdownV2`
- `supabase/functions/_shared/parlayfarm-format.ts` — add `renderCascade()` and `renderCorrelatedMove()`

### Out of scope

- Settlement narratives and dawn briefs (they have their own intentional v1-Markdown formatting per spec — non-alert messages).
- The actual signal-detection logic stays untouched; only the rendering changes.

