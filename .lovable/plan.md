# Spike Reverse-Psychology "Fade Me" Parlay

Spike gets a new persona mode where he confidently hands the user a parlay built to LOSE — picks engineered as the worst-outcome combo — and tells them to fade every leg if they want to actually print. If he doesn't have enough conviction to construct a confidently-bad ticket, he asks the user to upload screenshots of their book/slate for more context.

Note on the AI: per the project's stack, the cross-referencing is done through Lovable AI (the same gateway already powering Spike). We don't call Claude directly.

## What changes

### 1. New tool: `build_fade_parlay` (in `live-ai-agent`)
A sibling to `build_parlay`. Same gating (Pup quota / All-Access bypass), but it inverts the engine:

- Pull from `final_verdict_picks` for today, but select the **worst** candidates instead of the best:
  - Lowest `consensus_score` (e.g. ≤ 45)
  - Worst `verdict_grade` tier (D, C-, C)
  - Bonus weight if `fanduel_signal_type` is in the blacklisted poison set (`snapback`, `live_drift`) — those are documented as the highest miss-rate signals and are perfect fade fodder.
  - Bonus weight if a contradicting whale/sharp signal is on the **opposite** side.
- Diversify across distinct players (same dedupe logic as `build_parlay`).
- Default 3 legs (or whatever the user's risk mode wants).
- Compute combined odds + an "estimated hit chance" that is intentionally low.
- Flag the payload as `fade_mode: true` and flip every leg's `recommended_side` so the user knows: "Spike says OVER → you bet UNDER."
- Save to `live_ai_generated_parlays` with a new column `fade_mode boolean default false` so we can track these tickets separately when grading.

If the worst-pool returns < required legs OR confidence in "this is genuinely a bad ticket" is weak, return a structured `needs_more_context` result that triggers Spike to ask for screenshots.

### 2. Persona / system prompt
Spike gets a new mode personality block. Active when the user opts into "Fade Me" mode (new pill in the UI) or asks anything like "give me a fade parlay / reverse psychology / loser ticket / fade-the-dog":

> "Yo — straight up, I'm cookin' the dumbest 3-legger I can find. Don't tail me. **Fade every leg.** That's where the money is tonight."

He tells the user explicitly to bet the OPPOSITE side of each leg he names. He stays in Brooklyn-bulldog character.

When his worst-pool comes up thin, he says something like:
> "I need more to work with. Snap me a screenshot of your book's slate or the boards you're lookin' at and I'll cook somethin' truly terrible for ya to fade."

### 3. UI — `AIParlayCard`
When `parlay.fade_mode === true`:
- Card border + accent flips to a "danger" semantic token (using existing destructive token in the design system, no hard-coded colors).
- Header pill says "🚫 FADE THIS" instead of the risk-mode emoji.
- Each leg shows the ENGINE side struck through with the FADE side highlighted:
  ```
  Tatum Points OVER 28.5  →  bet UNDER 28.5
  ```
- Footer line: "Spike's ticket: ~12% to hit · Your fade ticket: ~88%"
- Small disclaimer: "Reverse-psychology mode — bet the opposite of what's listed."

### 4. UI — Mode pill in `LiveAI.tsx`
Add a fourth risk pill alongside Aggressive/Smart/Safe:
- 🚫 **Fade Me** — toggles `mode = "fade"` on requests to `live-ai-agent`.
When this mode is active, Spike's responses route to `build_fade_parlay` instead of `build_parlay`.

### 5. Screenshot ask path
The slip-upload affordance already exists in LiveAI (the `image/*` input that hits `live-ai-slip-scan`). When `build_fade_parlay` returns `needs_more_context`, Spike's reply includes a magnetic prompt to use that existing upload button — no new UI surface needed. We'll surface a small inline "📸 Upload screenshot" hint button under his message to make the affordance obvious in this mode.

### 6. Tracking
- DB migration: add `fade_mode boolean default false not null` to `live_ai_generated_parlays`.
- When grading these tickets later, a fade ticket "wins" when the engineered legs LOSE (i.e., the user's fade hits). This keeps Spike's fade-mode accuracy honest and separate from his straight build accuracy.

## Files touched

- `supabase/functions/live-ai-agent/index.ts` — new tool definition, new tool branch, persona block, fade-mode routing.
- `supabase/migrations/<new>.sql` — add `fade_mode` column.
- `src/components/live-ai/AIParlayCard.tsx` — fade rendering branch.
- `src/pages/LiveAI.tsx` — Fade Me pill, pass mode to agent, render screenshot-upload hint when `needs_more_context`.

## Out of scope
- Auto-grading / outcome tracking of fade tickets (column added, grader update is a follow-up).
- Telegram broadcast of fade picks.
- Any change to the Telegram alert engines or settled-pick logic.

Approve and I'll switch to build mode and implement.
