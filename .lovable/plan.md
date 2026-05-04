# Promote Spike from the Landing Page

The homepage (`/`) is already our landing page. We'll add a floating "Meet Spike" promo that appears after a short delay, and let visitors try Spike in a limited "sample" mode on `/live-ai` without signing up.

## 1. Floating Spike Promo (Homepage)

New component: `src/components/farm/SpikePromoPopover.tsx`

Behavior:
- Mounts on `Home.tsx` only.
- Appears bottom-right after ~6 seconds on page (or after 25% scroll, whichever is first).
- Dismissible (X button); dismissal stored in `localStorage` (`spike_promo_dismissed_v1`) so it doesn't nag returning visitors.
- On mobile: positioned above the existing `StickyMobileBar` (`bottom: 88px`) so it doesn't overlap.

Visual:
- Small card (~320px wide) with Spike's avatar thumbnail, heading "Talk to Spike", one-line pitch ("Your AI handicapper — try a free sample, no signup"), and two buttons: **"Try Spike Free"** (→ `/live-ai?sample=1`) and **"Maybe later"** (dismiss).
- Subtle pulse/glow on first appearance, then static.
- Uses farm-theme tokens (no hardcoded colors).

Wired in `Home.tsx` near the bottom of the tree.

## 2. Sample Mode on `/live-ai`

`LiveAI.tsx` reads `?sample=1` from the URL and enters **Sample Mode**:

- Banner at top: "You're in Sample Mode — 2 free messages. Sign up for the full Spike."
- Allows up to **2 chat turns** with Spike (tracked in `sessionStorage` as `spike_sample_turns`).
- Disables the parlay-build and slip-scan tools in sample mode (no card on file → no quota row).
- After 2 turns, input is disabled and a CTA card replaces the composer: **"Create a free Pup account to keep chatting"** → routes back to homepage pricing (opens the email-capture / $0.50 verification flow).

## 3. Edge Function Update

`supabase/functions/live-ai-agent/index.ts`:
- Accept an optional `mode: "sample"` flag in the request body.
- When `mode === "sample"`:
  - Skip Supabase auth lookup; treat as anonymous.
  - Force-disable `build_parlay` and `analyze_slip` tools (don't register them).
  - Inject a system-prompt addendum: "You are in sample mode. Give a taste of your personality and one piece of general handicapping insight, then encourage the user to sign up for full access (Pup is free with card verification)."
  - No quota writes.
- Server-side cap: reject with a friendly upsell if the request carries more than 2 prior assistant messages (defense against client tampering).

## 4. Files Touched

Created:
- `src/components/farm/SpikePromoPopover.tsx`

Edited:
- `src/pages/Home.tsx` — mount the popover.
- `src/pages/LiveAI.tsx` — sample-mode detection, banner, turn cap, upsell CTA.
- `supabase/functions/live-ai-agent/index.ts` — `mode: "sample"` branch.

No DB migrations. No new env vars.

## Out of Scope

- No changes to pricing tiers, Stripe flow, or Telegram gating (handled previously).
- No redesign of homepage sections themselves.
