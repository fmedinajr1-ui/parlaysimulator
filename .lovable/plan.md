## Problem

The Acuña "Slate Outlier" card you verified in Claude has three repeating defects (same shape as the Harris card) plus a new one specific to baseball:

1. **Verdict ↔ pick contradiction.** Header says `🎯 SLATE OUTLIER — FADE` and badge says `🔴 Verdict: FADE`, but the bet line says `Over`. In `signal-alert-telegram/index.ts` (lines 265–331) we already flip `side` to the opposite of `original_side` in fade mode — so the *pick we render* is the correct action ("Back Over"), but the word "FADE" next to it reads as the opposite. The "flipping to Over" sentence then becomes circular.
2. **Juice shown on PrizePicks.** `+250` is meaningless for fixed-payout books. We're rendering American odds regardless of `bookmaker`.
3. **No injury / cold-form sanity gate.** Acuña is .236 / .695 OPS, 0-for-3 yesterday, returning from hamstring + thumb. `injury_reports` and `nba_player_game_logs` / MLB equivalents already exist; we just don't consult them for velocity_spike before broadcasting.
4. **Templated feel.** Same paragraph text across players because no player-specific form/health line is ever inserted.

## Fix

### 1. Rewrite the velocity_spike card copy so the action is unambiguous

In `supabase/functions/signal-alert-telegram/index.ts` (the `if (a.signal_type === 'velocity_spike')` block):

- Replace the dual "FADE" verdict with a single **action verb that matches the rendered side**:
  - `play` mode → header `🚀 SLATE OUTLIER — BACK {side}`, badge `🟢 Action: BACK {side}`.
  - `fade` mode → header `🎯 SLATE OUTLIER — FADE PUBLIC {originalSide}`, badge `🟢 Action: BACK {side}` *(the bet)*, with a separate `🔴 Public lean: {originalSide}` line.
- Rewrite `verdictWhy`:
  - play: `Cohort hits {hr} on {originalSide} (n={sampleN}) — we ride with the book.`
  - fade: `Cohort only hits {hr} on {originalSide} (n={sampleN}) — we bet {side} instead.`
- One-line TL;DR at the top of the body: `*Bet:* {player} {side} {line} ({prop})` so the recommended action is never ambiguous, regardless of header wording.

### 2. Hide American odds on PrizePicks (and any fixed-payout book)

- Add a `isFixedPayoutBook(bookmaker)` helper (`prizepicks`, `underdog`, `sleeper`, `dabble`).
- In the velocity_spike branch and in `take_it_now` (lines 233–263), suppress the `prices: Over … / Under …` and `juice gap` lines when fixed-payout. Replace with: `💎 PrizePicks pick (fixed payout)`.

### 3. Pre-send sanity gate: drop on injury / cold-form

New helper `_shared/velocity-spike-health-gate.ts`:

- Inputs: `{ player_name, sport, prop_type, side, line }`.
- Reads, in one batch per run:
  - `injury_reports` (latest row per player, last 7d) — drop if `status` ∈ {OUT, DOUBTFUL, GTD} or `impact_score >= 6`, or any `injury_detail` contains `hamstring|thumb|wrist|hand|oblique` (high-impact for contact props) AND prop is a contact/singles/total bases over.
  - MLB form: `mlb_player_game_logs` (or current source) last 5 games — flag if `H/AB < .200` AND prop is `Hits Over` / `Total Bases Over` / `Singles Over`.
  - NBA form: `nba_player_game_logs` last 5 — flag if mean of relevant stat below the line on 4+ of 5.
- Return `{ block: boolean, reason: string, soft_warn: string | null }`.
- In `signal-alert-telegram` filter loop (around line 365), call the gate per alert. `block=true` → skip with `stats.skipped_cold_form++`. `soft_warn` → render as `⚠️ Form check: {reason}` line in the card body so the user sees it even when we still send.

### 4. Make each card feel less templated

For every velocity_spike card add a one-line player snapshot under the bet line:

```
📈 {player}: L5 {hits_or_avg}, season {ba_or_avg} • {opponent_pitcher_or_defense_rank}
```

Source from `player_season_stats` / `mlb_player_season_stats` (already in batch loads via `loadRoleContexts` pattern; mirror that helper for MLB if missing).

## Files touched

- `supabase/functions/signal-alert-telegram/index.ts` — copy rewrite, fixed-payout suppression, gate wiring, per-player snapshot line.
- `supabase/functions/_shared/velocity-spike-health-gate.ts` *(new)* — batch loader + decision.
- `supabase/functions/_shared/velocity-spike-health-gate_test.ts` *(new)* — 5 unit tests per house rule (cold MLB hits, hamstring out, healthy/hot, NBA cold L5, fixed-payout juice suppression).
- `mem/logic/betting/velocity-spike-strength-meter.md` — append: "Health + cold-form gate runs before broadcast; FADE cards render as BACK {bet_side} to remove badge/pick contradiction."

## Verification after build

1. Run unit tests for the new gate.
2. Manually trigger `signal-alert-telegram` and dump one velocity_spike message for an MLB Over and one for an NBA Over — confirm header, badge, and bet line all name the same side, and that PrizePicks rows have no `+250`.
3. SQL spot-check: for any alert blocked by the gate, verify the underlying `injury_reports` / form row supports the block.
4. Re-run on the Acuña row specifically — confirm it now either blocks (hamstring/thumb + .236 BA on Hits/Singles Over) or sends with a `⚠️ Form check` warning, never as a clean FADE/Over contradiction.

## What this does NOT change

- The v3 Court.Edge engine, the cascade card, or any non-velocity_spike signal type.
- The underlying strength meter math (`_shared/velocity-spike-strength.ts`) — only the *presentation* and a new *pre-send filter*.
