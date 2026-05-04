# Cascade Alert v3 — Split, Clean, Narrate

## Problems in the current alert

Looking at the example you pasted:

1. **One giant wall of text.** 7 players + sim + counts + verdicts all crammed into one message. Hard to scan on phone.
2. **Duplicates.** Josh Hart appears twice in the player list — same line, same conf. Engine isn't deduping `player_breakdown` on `player+side+line`.
3. **`UNKNOWN` archetypes / blank labels.** When `player_archetypes` has no row, we render `👤 UNKNOWN · ROTATION` which looks broken. Same for `Game TBD` and missing tipoff.
4. **Jargon.** `L10`, `σ`, `juice gap 232`, `conf 70%`, `U 19.5`, `STRETCH_BIG · ROTATION (27.8 mpg)` — nobody outside the dev knows what this means.
5. **Sim math reads wrong.** "FADE (any miss): p=98% EV=+$2.59 Risk: $3.00 → win $2.73" — winning $2.73 on a 98% bet at $3 risk doesn't communicate value clearly. Likely correct math, terrible labels.

## What we'll ship

### 1. Split into 3 short Telegram messages per cascade

Instead of one 60-line wall, send a thread:

- **Message A — The Call** (≤ 12 lines): action + game + what to bet + Spike's plain-English take.
- **Message B — The Math** (≤ 8 lines): bankroll sim with friendly labels.
- **Message C — The Players** (≤ 25 lines): clean leg-by-leg list, deduped, jargon translated.

Telegram threads them under a single `reply_to_message_id` so the chat stays organized.

### 2. Fix the data-quality bugs

- **Dedupe `player_breakdown`** in `signal-alert-engine` on `(player_name, side, line)` before insert — kills the "Josh Hart twice" issue.
- **Skip role line entirely when archetype is UNKNOWN** — no more `👤 UNKNOWN`. If we have minutes but no archetype, render just the tier + mpg ("Starter, 28 mpg"). If we have nothing, omit the line.
- **Friendly fallbacks** for missing game / tipoff: `"Tonight's slate"` instead of `"Game TBD"`; only show tipoff when it parses.

### 3. Spike narrator — plain-English explainer

Add a new shared helper `spikeNarrate(cascade)` that produces 2-3 sentences with personality. No LLM call (latency + cost), just templated phrasing driven by the verdict + model + counts.

Examples it would generate:

> **Spike says:** "5 of 7 picks line up clean — book is paying like the Under is the cold side and our model agrees by a wide margin. This is one of the higher-conviction tails of the night. Take 3-pick, skip the 7-leg lottery."

> **Spike says:** "Mixed bag here. Numbers say Under but only 1 leg is rock-solid. If you're playing, keep it small or wait for a sharper signal."

The narrator has access to: `verdict_counts`, `model_agree`, `defense_against`, `actionKind`, `players.length`, and the alerted side. Returns a single string — drops cleanly into Message A.

### 4. Translate the jargon in the player list

Per-leg lines change from:

```
• Mikal Bridges  U 12.5  conf 90%
   ↳ L10 Under 10/10
   ↳ Juice gap 232 (book on this side) · ⚠️ volatile minutes
   ↳ Verdict: ✅ STRONG — L10 Under 10/10 · juice +232 · volatile minutes ⬇️
   ↳ 🎯 COMBO_GUARD · STARTER (30.3 mpg)
```

To:

```
• Mikal Bridges — Under 12.5 rebounds  ✅
   Hit the Under in all 10 of his last 10 games.
   Book is heavily on this side (gap +232).
   Heads-up: his minutes have been bouncing around lately.
```

`STRONG/LEAN/WEAK` → ✅ / 👍 / ⚠️ emoji only (badge stays for scanability, label drops).
`L10 U 10/10` → "Hit the Under in all 10 of his last 10 games."
`juice gap NN (book on this side)` → "Book is heavily on this side (gap +NN)" or "Book is leaning this way (gap +NN)" by magnitude.
`volatile minutes` → "Heads-up: his minutes have been bouncing around lately."
Archetype/role → only when meaningful and known.

### 5. Friendly sim labels

Replace the raw `p= EV= Risk= win=` block with:

```
💰 If you bet $100:
  • All 7 legs together → 2% chance, pays $60 (long shot)
  • Just the top 3 strongest → 24% chance, pays $18 (the realistic play)
  • Fade the whole group → 98% chance, pays $3 (tiny edge)

Best play: top 3 strongest. Spike's call.
```

The sim object already has the numbers — we just relabel and add a one-line recommendation derived from the same actionKind.

## Files we'll touch

- `supabase/functions/signal-alert-telegram/index.ts` — split formatter into `formatCallMessage`, `formatSimMessage`, `formatPlayersMessage`; thread via `reply_to_message_id`; integrate Spike narrator + jargon translator.
- `supabase/functions/_shared/alert-explainer.ts` — add `formatPlayerReasoningPlain()` (plain-English variant) alongside existing `formatPlayerReasoningLines()`. Keep old one for backward compat.
- `supabase/functions/_shared/spike-narrator.ts` (new) — `spikeNarrate(input) → string`, pure function, no DB.
- `supabase/functions/_shared/cascade-sim.ts` — add `formatCascadeSimPlain(sim, actionKind)` that returns the friendly sim block.
- `supabase/functions/_shared/player-role-context.ts` — `formatRoleLine` returns `null` for UNKNOWN archetype + UNKNOWN tier; tightens "leak" surface.
- `supabase/functions/signal-alert-engine/index.ts` — dedupe `playerBreakdown` on `(player|side|line)` before insert.
- `supabase/functions/bot-send-telegram/index.ts` — accept optional `reply_to_message_id` and return `message_id` (likely already does) so we can thread.
- Tests:
  - `supabase/functions/_shared/spike-narrator_test.ts` (5 tests: STRONG-tail, mixed-review, fade, skip, edge-case all-neutral).
  - `supabase/functions/_shared/alert-explainer_test.ts` — 5 new tests for `formatPlayerReasoningPlain`.

## Out of scope (for this pass)

- LLM-generated narration (templated only — keeps latency/cost predictable; can layer Lovable AI later if you want true personality).
- Inline buttons ("Tail it" / "Skip"). Easy to add once Telegram bot routing is wired up.
- Per-user formatting preferences. Everyone gets the new format.
