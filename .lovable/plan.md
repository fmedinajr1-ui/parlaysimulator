## What's actually broken

Looking at the page right now, four things are wrong and they compound:

1. **The dog isn't there.** The fallback portrait `<img>` in `DogAvatarVideo.tsx` is hardcoded to `opacity-0` (line 56) — so even when the idle MP4 fails to load, you see a black box. And the idle MP4 URL (`/__l5e/assets-v1/.../parlayfarm-dog-idle.mp4`, 16 MB) is a sandbox-internal asset path that often doesn't resolve in the published preview. Result: black square with a "SPIKE" pill and nothing else.

2. **Spike never speaks first.** The page loads, shows a written intro line, and just waits for you to hold the mic. You wanted him to greet you out loud the moment the page opens.

3. **Every backend call 401s.** Network log confirms `Authorization: Bearer undefined` on `live-ai-stt-token`. The page was made public (no auth gate) but the edge functions (`live-ai-tts`, `live-ai-stt-token`, `live-ai-agent`, `live-ai-slip-scan`) all require a logged-in user. So mic, slip upload, and TTS all silently fail.

4. **Client/server contract mismatch.** `LiveAI.tsx` posts `{ message, risk_mode, history }` to `live-ai-agent`, but the function reads `{ user_text, mode }` and ignores history (it loads its own from DB). Even with auth fixed, replies wouldn't work right.

## The fix

### 1. Make the avatar actually visible (`src/components/live-ai/DogAvatarVideo.tsx`)
- Use the static portrait PNG (`parlayfarm-dog-avatar.png` — already in assets) as the **always-on base layer**, full-cover, with a soft animated gradient halo.
- Keep the idle MP4 as an **enhancement** that fades in only after `onCanPlay` fires. If the MP4 never loads (sandbox URL issue), the portrait stays — no more black screen.
- Remove the `opacity-0` bug on the speaking-pulse image.
- Add a subtle breathing animation to the portrait so it feels alive even when idle.
- Make speaking pulse drive a glow ring + gentle scale on the portrait, not an invisible image.

### 2. Spike greets you on page load (`src/pages/LiveAI.tsx`)
- On mount, after the audio context is allowed (first user tap anywhere — required by iOS Safari), auto-fire one TTS line: *"Yo, what's good? Spike here. Tap the mic, upload a slip, whatever you got — I'm ready."*
- Show a one-time "Tap to wake Spike up" overlay before first interaction so iOS unlocks audio. After tap → greeting plays + idle video starts looping.
- Pre-render that greeting line via `live-ai-tts` so it's instant.

### 3. Allow the page to work without sign-in
Two options here — the cleanest is to make the public-facing pieces work anonymously:
- Edit `live-ai-tts`, `live-ai-stt-token`, `live-ai-agent`, `live-ai-slip-scan` to accept calls without a user. For anonymous sessions:
  - Skip the DB persistence (no `live_ai_conversations` / `live_ai_messages` row).
  - Cap per-IP usage with an in-memory rate limit (already have `live_ai_user_prefs` for signed-in caps).
  - Still require the Supabase anon key on the request (CORS/abuse floor).
- The page already calls `supabase.functions.invoke(...)` which auto-attaches the anon key when no session — so once the functions stop hard-rejecting on missing user, calls flow through.

### 4. Fix the agent request contract (`src/pages/LiveAI.tsx`)
- Send `{ user_text, mode, conversation_id }` (matching what the edge function reads).
- Read `data.text` (not `data.reply`) for the assistant message.
- Pass `live_mode: false` for now (Live Mode UI lands later as you originally asked).

### 5. Tighten the layout so it feels like FaceTime, not a chat app
- Avatar fills **full screen** behind everything (not capped at 55vh).
- Transcript becomes a translucent overlay along the bottom 40%, fading at the top.
- Risk pills float top-right over the dog.
- Mic + slip-upload buttons sit on a glass bar at the very bottom, big and tappable.
- Hide page scroll; only the transcript scrolls inside its own area.

## Files I'll change

```text
src/components/live-ai/DogAvatarVideo.tsx   — portrait-first, MP4 enhancement, fix opacity bug
src/pages/LiveAI.tsx                        — greeting-on-tap, FaceTime layout, fix agent contract
supabase/functions/live-ai-tts/index.ts     — allow anonymous, add per-IP rate cap
supabase/functions/live-ai-stt-token/index.ts — allow anonymous
supabase/functions/live-ai-agent/index.ts   — allow anonymous, skip DB writes when no user
supabase/functions/live-ai-slip-scan/index.ts — allow anonymous
```

## Out of scope (still coming in v2 as we agreed)
- Live Mode game-watcher dashboard
- Push notifications opt-in
- HeyGen lip-synced talking dog video (the `live-ai-avatar-render` call stays as a no-op fallback for now)

## Result
You open `/live-ai` → you immediately see the bulldog portrait with a soft glow → tap once to wake him → he says "Yo, what's good? Spike here…" in the Brian/NY voice → mic and slip upload both work without logging in → no more black screen, no more 401s.
