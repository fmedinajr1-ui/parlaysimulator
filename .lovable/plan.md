## ParlayFarm Live AI — Voice + Video Dog Avatar Assistant

Locked-in scope: real talking-dog avatar, live game mode, slip scanning, push alerts — all in v1. ElevenLabs voice with New York accent.

### The vibe

```text
┌─────────────────────────────┐
│  🐕 PARLAYFARM LIVE         │
│  ┌───────────────────────┐  │
│  │                       │  │
│  │   [Talking Dog Vid]   │  │
│  │   "Yo, lemme tell ya  │  │
│  │    about Brunson..."  │  │
│  │                       │  │
│  └───────────────────────┘  │
│  📡 LIVE • Listening...     │
│                             │
│  Parlay cards stack here    │
│                             │
│  [🎤 Talk]  [📸 Scan Slip]  │
│  Mode: 🔥 🧠 🛡️ │ LIVE 🔴   │
└─────────────────────────────┘
```

### The dog (avatar)

**Two-layer approach** so it's cheap + always-on but feels alive:

1. **Idle loop** (default): pre-rendered 8-second seamless MP4 of the ParlayFarm dog mascot — slight head bob, blinking, tail wag. Generated once via Lovable AI image gen → Remotion compositing → uploaded to Supabase Storage. Loops forever in `<video autoplay loop muted>`.
2. **Speaking moments**: when the AI responds, swap to a **HeyGen** (or **D-ID**) generated talking-head video clip lip-synced to the ElevenLabs audio. Generated on-the-fly per response, cached per identical text.

The dog character: a sharp-dressed bulldog or shiba in a Yankees cap + chain, sportsbook backdrop. Generated as the persistent character image + reused for every HeyGen call so the dog always looks the same.

Fallback if HeyGen isn't enabled: animated CSS dog avatar (the existing `DogAvatar` component, scaled up + reactive to `getOutputVolume()` for mouth movement). Voice still works perfectly.

### The voice

ElevenLabs voice **"Brian" (`nPczCjzI2devNBz1zQrb`)** — closest in their stock library to a NY/Brooklyn sportsbook bro. Optional alternative: I'll let you preview clips of `Eric` and `Bill` too. For a guaranteed NY accent we'd need a custom **Voice Lab** clone (you upload 1 min of a NY accent clip → permanent voice ID); flagging this as the upgrade path.

Model: `eleven_turbo_v2_5` for sub-400ms first audio.

### Architecture

```text
┌─ Mic ──► Scribe Realtime STT ──┐
│                                 ▼
│         ┌── live-ai-agent (edge fn) ──┐
│         │  Lovable AI + tool-calling  │
│         │  Tools:                     │
│         │   get_player_L10            │
│         │   get_odds                  │
│         │   get_matchup_data          │
│         │   get_injuries              │
│         │   get_whale_signals         │
│         │   build_parlay(risk)        │
│         │   analyze_parlay(slip)      │
│         │   live_game_state(gameId)   │
│         │   send_to_telegram          │
│         └─────────────┬───────────────┘
│                       │
│              ┌────────┴────────┐
│              ▼                 ▼
│     ElevenLabs TTS      HeyGen avatar
│     (streaming)         (lip-synced clip)
│              │                 │
│              ▼                 ▼
└──── Speaker + Talking-dog video + Parlay cards
```

### Files to create

**Edge functions**
- `live-ai-agent` — main brain, Lovable AI + tool execution.
- `live-ai-stt-token` — issues ElevenLabs Scribe single-use token.
- `live-ai-tts` — streams TTS audio back to client (returns audio URL + the text for HeyGen).
- `live-ai-avatar-render` — calls HeyGen API with the audio URL + dog character ID, returns lip-synced MP4 URL. Caches by audio hash.
- `live-ai-slip-scan` — accepts uploaded image, runs through existing OCR flow → calls `analyze-parlay`.
- `live-ai-game-watcher` — cron every 30s during live games; computes "take it now" alerts using `useLivePBP` data; pushes via web-push to subscribed users.

**Frontend (`/live-ai` route)**
- `pages/LiveAI.tsx` — main FaceTime-style page.
- `components/live-ai/DogAvatarVideo.tsx` — handles idle-loop ↔ speaking-clip crossfade.
- `components/live-ai/MicButton.tsx` — push-to-talk + tap-to-toggle, haptic feedback.
- `components/live-ai/TranscriptStream.tsx` — live captions.
- `components/live-ai/AIParlayCard.tsx` — leg cards w/ L10 dots, confidence %, whale 🔥/🌡️/❄️, action buttons.
- `components/live-ai/ModeSelector.tsx` — 🔥 Aggressive / 🧠 Smart / 🛡️ Safe + 🔴 LIVE toggle.
- `components/live-ai/SlipScanner.tsx` — camera/file upload → scan → results.
- `components/live-ai/LiveAlertBanner.tsx` — "TAKE IT NOW" red banner when live edge detected.
- `hooks/useLiveAIConversation.ts` — orchestrates STT → agent → TTS+avatar pipeline.
- `hooks/useLiveGameAlerts.ts` — subscribes to realtime alerts table for live nudges.

**Database migration**
- `live_ai_conversations`, `live_ai_messages`, `live_ai_generated_parlays`, `live_ai_user_prefs` (mode, favorite teams, NY accent toggle, push enabled), `live_ai_avatar_cache` (audio_hash → heygen video URL), `live_ai_alerts` (live "take it now" nudges, realtime-enabled).
- All RLS scoped to `auth.uid()`.

**Storage buckets**
- `dog-avatar-assets` (public) — idle-loop MP4, dog character reference image.
- `live-ai-slips` (private, RLS) — uploaded bet slip images.

### Live Mode (real-time)
Toggle subscribes the user to `useLivePBP` for tracked games. The `live-ai-game-watcher` cron checks every 30s for:
- Line about to move (whale signal + score divergence)
- Player on pace to crush a line they recommended
- Foul trouble killing a leg

When triggered → inserts row in `live_ai_alerts` (Supabase realtime pushes to UI) **and** sends web-push if subscribed. Dog pops up and says it.

### Slip scanning (v1)
Reuses existing OCR pipeline. Camera capture or file upload → `live-ai-slip-scan` → returns parsed legs → AI dog reads it back, tells you which legs it likes/hates, suggests swaps. Same UX as voice flow.

### Push notifications (v1)
Reuses existing `usePushNotifications` hook + `send-push-notification` edge function (already built). New notification type: `live-ai-alert`. Subscribers get pushed when their live picks need action — even with the app closed.

### Secrets needed
- `ELEVENLABS_API_KEY` — already present (used by explainer worker).
- `HEYGEN_API_KEY` — **need to add**. I'll prompt you when we build the avatar function. ($30/mo starter plan covers ~100 talking-head minutes.)
- `LOVABLE_API_KEY` — auto-provisioned.
- VAPID keys — already configured for push.

### Cost reality
- Voice round-trip: ~1.5–2s perceived latency. ✅
- Voice + HeyGen avatar: 4–8s before dog talks. ⚠️ Mitigations:
  1. Stream voice immediately, swap idle dog to speaking dog as soon as HeyGen URL ready (2nd half of response).
  2. Cache HeyGen clips by audio hash — common phrases ("Here's a 3-leg parlay", "Whale money detected") only render once.
  3. For instant feel, idle-loop dog has subtle mouth motion already, so the swap is barely visible.

### What I'll need from you mid-build
1. Approval to add `HEYGEN_API_KEY` secret when we get to the avatar step.
2. Pick one: stock voice **Brian** for now, or hold for me to build a Voice Lab clone setup so you can upload a custom NY-accent sample later.
3. Approve dog character look — I'll generate 3 options (bulldog/shiba/pitbull, all in Yankees cap + chain, sportsbook backdrop) and you pick.

### Build order
1. Migration + storage buckets + secrets.
2. Generate dog character + idle-loop video (Remotion).
3. `live-ai-agent` edge fn with all tools wired to existing engines.
4. Voice loop (STT → agent → TTS) working end-to-end with CSS dog fallback.
5. HeyGen avatar integration + caching.
6. Slip scanning.
7. Live Mode + push notifications.
8. Polish: haptics, animations, free-tier gating (3 parlays/day → paywall).

Approve and I'll start with the migration + dog character generation.