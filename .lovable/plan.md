# Fix: Create missing `/live-ai` page

## The crash
Vite is failing because `src/App.tsx` lazy-imports `./pages/LiveAI`, but `src/pages/LiveAI.tsx` was never created in the previous step. Only `DogAvatarVideo.tsx` exists in `src/components/live-ai/`. That's the entire reason the preview is red right now.

## What I'll build

### 1. `src/pages/LiveAI.tsx` (the missing file)
A FaceTime-style screen for Spike, the Brooklyn-bulldog AI:

- **Top half**: `<DogAvatarVideo />` filling a rounded card, with the LIVE/SPIKE pill already baked into the component. Shows the idle MP4 loop, swaps to HeyGen lip-sync clip when available, otherwise pulses the portrait to the audio output volume.
- **Transcript stream**: scrollable list of user + Spike messages (markdown-rendered for Spike's replies), persisted to `live_ai_messages`.
- **Mic button**: big circular push-to-talk at the bottom. Uses ElevenLabs Scribe (`scribe_v2_realtime`) via `live-ai-stt-token` for live transcription, then sends final transcript to `live-ai-agent`.
- **Spike's reply pipeline**: text → `live-ai-tts` (Brian voice, NY-leaning settings) → play MP3 via `<audio>` + AnalyserNode to drive `outputVolume` for the avatar pulse. In parallel, fire `live-ai-avatar-render` for the lip-synced clip; when it resolves, swap into `speakingVideoUrl`.
- **Risk mode pills** (🔥 Aggressive / 🧠 Smart / 🛡️ Safe) saved to `live_ai_user_prefs` and passed to the agent.
- **Generated parlay cards**: when the agent's tool-call returns a parlay, render `AIParlayCard` inline in the transcript with tap-to-add-to-builder.
- **Free-tier gate**: read `live_ai_generated_parlays` count for today; if ≥ 3 and user is not pro, show paywall modal instead of generating.
- **Auth gate**: if logged out, show a "Sign in to talk to Spike" screen instead.

### 2. `src/components/live-ai/AIParlayCard.tsx` (new, small)
Renders one generated parlay with legs, combined odds, risk mode badge, and an "Add to slip" button that calls into `ParlayBuilderContext`.

### 3. `src/components/live-ai/MicButton.tsx` (new, small)
Encapsulates the Scribe connect/disconnect + recording state + level meter ring.

### 4. Sanity sweep
- Confirm `live-ai-stt-token`, `live-ai-tts`, `live-ai-agent` edge functions exist (they do — already created last turn).
- Confirm `@elevenlabs/react` is in `package.json`; if missing, add it.

## Out of scope for this fix
Slip scanning UI, push-notification opt-in UI, and Live Mode game-watcher dashboard already have their backend pieces (`live-ai-slip-scan`, `live-ai-game-watcher`) but their frontends will land in a follow-up — not needed to unblock the crash.

## Result
Preview compiles, `/live-ai` loads, you can tap the mic, talk to Spike, and hear him talk back in the Brian voice with the dog idle loop pulsing. HeyGen video kicks in once you add `HEYGEN_DOG_AVATAR_ID`.
