## Goal

Make Spike feel like a real assistant (not just a parlay tool), give every user a permanent shareable link to him, and fix the cluttered wake-up screen where the "Tap to wake" pill overlaps the mic + risk-mode chips.

## 1. Persona upgrade (`supabase/functions/live-ai-agent/index.ts`)

Rewrite `SYSTEM_PROMPT` so Spike:
- Answers **general questions** (small talk, sports trivia, rules explanations, "what's a moneyline", "who plays tonight", weather/jokes/etc.) in his Brooklyn voice, ~2-4 sentences.
- Gives **sports-betting education** freely: bankroll basics, how parlays correlate, how to read a line, what variance means, why chasing tilts you. Concepts and frameworks are fair game.
- **Withholds proprietary edge for free**: no specific player picks, no parlay legs, no whale/sharp reads, no "today's plays" unless the caller is `pup` (1/day) or `all_access`. When asked for a pick as anon/sample, he teases ("I got a juicy 3-legger cooked, but the real plays drop inside — grab a free Pup account and I'll hand you one today") and points to `/upgrade`.
- Has a clear refusal pattern that stays in character instead of a flat "I can't".
- Adds a `share_my_link` behavior: when the user says "send me the link", "how do I get back here", "save this", "text it to me", Spike replies with their personal Spike URL (see §2) and tells them to bookmark or DM it to themselves.

Add 5 unit tests in a new `_test.ts` covering: general-question answer, betting-education answer, anonymous pick refusal w/ upsell, "send me the link" trigger, all-access unrestricted path.

## 2. Persistent personal Spike link

Goal: every signed-in user gets a stable URL like `/spike/u_<token>` they can bookmark or share with themselves; opening it auto-resumes their Spike conversation without re-login friction (still gated behind auth — token just identifies them, session still required).

- **Migration**: new column `spike_share_token text unique` on `profiles` (or `pup_users` if that's the canonical table — verify in next step). Backfill with `gen_random_uuid()`. Trigger to auto-fill on insert.
- **Route**: add `/spike/:token` in `src/App.tsx` mapping to `LiveAI`. `LiveAI` reads `useParams().token`, looks up `profiles` to confirm it matches the current `user.id`; if no session, redirect to `/auth?next=/spike/:token`; if mismatch, redirect to `/live-ai`.
- **Shareable URL surfaced in two places**:
  1. New `<SpikeShareCard />` rendered once after wake (signed-in only) with copy-to-clipboard + "Text to my phone" (uses existing Telegram bot link if `telegram_chat_id` present, otherwise SMS `sms:?body=`).
  2. New `share_my_link` tool in the agent that returns `{ url }`; persona prompt instructs Spike to call it when asked. UI detects `tool_trace` entry and renders an inline link card under that message.
- **Onboarding email/Telegram**: extend the existing `bot-access` transactional template + the Telegram welcome to include the personal Spike URL ("Spike lives here anytime: https://parlayfarm.com/spike/<token>").

## 3. Wake-up UI cleanup (`src/pages/LiveAI.tsx`)

Current issue (per screenshot): the blue "Tap to wake Spike up" pill sits directly on top of the mic button and the "smart mode" badge, which bleed through the backdrop blur.

Fixes:
- Replace the bottom-pinned wake pill with a **centered card overlay** at ~40% from top: avatar visible above, button in dead-center, subtitle below. Use `items-center justify-center` (drop `pb-32`).
- Stronger backdrop: `bg-black/70 backdrop-blur-md` (was `bg-black/40 backdrop-blur-[2px]`) so underlying chips/mic are fully muted.
- Make the button more presentable:
  - Larger: `px-8 py-4`, rounded-2xl (not full pill), bigger type, paw icon to the left of text.
  - Subtle gradient (`bg-gradient-to-br from-primary to-primary/70`) + ring + soft outer glow instead of `animate-pulse`.
  - Hover/active scale transitions; remove the constant pulse (it makes it look like an error).
- Add a small "What can Spike do?" trio of pills under the subtitle (Ask anything · Bet education · Today's plays for members) so the value prop is immediate.
- Risk-mode chips: hide them under the wake overlay (`{woken && ...}`) so they don't peek through.

## Technical notes

- All persona changes are server-side; no client prompt edits.
- Token lookup uses an RPC `get_my_spike_token()` (security definer, returns `auth.uid()`'s row only) so RLS stays clean.
- `share_my_link` tool refuses for anonymous/sample users with a "sign up first, then I'll mint your link" message.
- No changes to TTS, slip-scan, or parlay-build pipelines.

## Files

- `supabase/migrations/<ts>_spike_share_token.sql` (new)
- `supabase/functions/live-ai-agent/index.ts` (edit: prompt + new tool)
- `supabase/functions/live-ai-agent/index_test.ts` (new, 5 tests)
- `supabase/functions/_shared/transactional-email-templates/bot-access.tsx` (edit: include link)
- `src/App.tsx` (edit: add `/spike/:token` route)
- `src/pages/LiveAI.tsx` (edit: token guard, wake overlay redesign, share card)
- `src/components/live-ai/SpikeShareCard.tsx` (new)
- `mem/features/spike/personal-link.md` (new memory)
