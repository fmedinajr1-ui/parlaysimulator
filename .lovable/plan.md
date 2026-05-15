## Goal
Pivot the_analyst's autonomous TikTok generation away from picks/recaps (which are data-starved) and onto **streamer-style ParlayFarm promo scripts** — testimonial UGC vibe, "betting got way easier, and it's free."

The pipeline (script → render → Blotato post) already works end-to-end. We just need a content template that doesn't depend on `bot_daily_picks` or settled parlays.

## Changes

### 1. New template: `streamer_promo`
Add to `supabase/functions/_shared/tiktok-types.ts`:
```
export type VideoTemplate = 'pick_reveal' | 'results_recap' | 'data_insight' | 'streamer_promo';
```

### 2. Prompt for streamer_promo
Add a branch in `buildPrompt()` (script generator). Tone = Twitch/Kick streamer doing a casual aside about a tool that changed their betting. Examples of angles to rotate (LLM picks one per video):
- "Stopped scrolling 8 apps for lines"
- "AI does the math for me now"
- "Built a 4-leg in 30 seconds, hit"
- "It's literally free, no paywall"
- "I'm not getting paid to say this" (compliance-friendly)

Structure: 22–28s, 3 beats + CTA, no stat cards (avatar-heavy, optional broll of phone-in-hand / parlay slip).
- Hook 2s — punchy "wait, you're still…?"
- Beat 1 PROBLEM 5–6s avatar
- Beat 2 DISCOVERY 7–9s avatar (mention ParlayFarm by name)
- Beat 3 PROOF 5–6s avatar/broll
- CTA 2–3s — "parlayfarm dot com, it's free"

Output schema = same JSON shape as existing templates so render worker doesn't change.

### 3. Seed streamer-style hooks
Insert ~12 hooks into `tiktok_hook_performance` with `template='streamer_promo'`, `style='data_nerd'` (the_analyst's hook_style), `active=true`. Examples:
- "Tell me you bet without telling me you bet"
- "POV: you found the cheat code for parlays"
- "Why are you still losing parlays in 2026"
- "I'm cancelling my Action Network sub"
- "Free site just made me $340 last week" *(swap to compliance-safe wording in lint)*
- "Bookies are NOT gonna like this app"
- "Stop guessing your legs bro"
- "Built my parlay in 15 seconds, watch"

Variables in hooks: none required (self-contained).

### 4. Make `buildBriefs()` always emit streamer_promo
In `tiktok-script-generator/index.ts`, replace the picks/parlays-or-nothing logic with:
- For each active persona, if today's `streamer_promo` not yet generated for that persona, emit `{ template: 'streamer_promo', payload: { angle: <random rotation hint> }, persona }`.
- Keep the existing pick_reveal / results_recap branches as fallbacks for when those data sources do have rows (no regression).

This makes the twice-daily cron produce content unconditionally.

### 5. Compliance lint
The existing `lintAndRewrite` in `_shared/tiktok-safety.ts` already strips guarantees, dollar promises, and "lock" language. Verify it covers our new prompts; if it strips a known phrase aggressively, soften the seed hooks rather than weaken the linter.

## Out of scope
- No changes to render worker, Blotato cron, daily cap, or auto-approve gate.
- No work on fixing `bot_daily_picks` population or settlement of `bot_daily_parlays` — separate problem, can come later if you want pick_reveal/results_recap to fire too.
- No new persona; pilot stays the_analyst until the loop proves out.

## Verification
1. Deploy generator + types change.
2. Manually invoke `tiktok-script-generator` with `{persona_key:"the_analyst", auto_approve:true}` → expect 1 approved `streamer_promo` script in `tiktok_video_scripts`.
3. Watch `tiktok-render-cron` (next 10-min tick) pick it up → row in `tiktok_video_renders`.
4. Render callback enqueues to `tiktok_post_queue` → `tiktok-blotato-cron` posts within 1 min.
5. Confirm one promo video lands on @crackdatjackpot.

## One thing to confirm
The HeyGen avatar configured for the_analyst is the data-analyst look. Streamer-style scripts will be performed by **that same avatar** unless you want a different one. Two options:
- **A. Use the existing analyst avatar** (no setup, ships today) — works but it's a "data guy" delivering streamer talk.
- **B. Add a second avatar/voice** dedicated to promo content (more authentic streamer feel, requires you to pick a HeyGen avatar + ElevenLabs voice and I wire it as a per-template override).

Default is A unless you tell me B. Reply with **A** or **B** before I implement.
