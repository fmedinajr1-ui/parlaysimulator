# Spike Instagram Promo — Plan

## Goal
Two ready-to-post Instagram videos featuring Spike (the talking-dog AI avatar) hyping ParlayFarm, in streetwise-hype style. Output: `/mnt/documents/spike-promo-9x16.mp4` and `/mnt/documents/spike-promo-1x1.mp4`.

## Concept & Script (~22s)
Streetwise hype: Spike on camera, hard-cut B-roll of the app, bold kinetic captions, accent color punches, no slow burn.

**VO (Spike, ~22s):**
> "Yo — I'm Spike. While your boy 'capper' is guessing on Twitter, I'm scanning every line, every injury, every sharp move — in real time.
> I read FanDuel and Hard Rock before they even settle. I find the leg they want you to miss.
> One chat. One pick. Zero noise.
> Talk to me free at parlayfarm.com — let's eat."

Sentence cadence maps 1:1 to 5 scenes.

## Pipeline (one-off, scripted — not a new app feature)

```text
1. write script → /tmp/spike-script.json
2. ElevenLabs TTS (voice "George" JBFqnCBsd6RMkjVDRZzb, streetwise speed 1.05)
       → /tmp/spike-vo.mp3
3. HeyGen v2 video/generate
       avatar = HEYGEN_DOG_AVATAR_ID (already in secrets)
       audio_asset = uploaded /tmp/spike-vo.mp3
       dimension 1080x1920  → /tmp/spike-avatar-9x16.mp4
       dimension 1080x1080  → /tmp/spike-avatar-1x1.mp4
       (poll status until completed, download)
4. Remotion compose (worker/spike-promo, new folder):
       - Scene 1 "DROP" : full-bleed Spike + neon ticker
       - Scene 2 "SCAN" : Spike picture-in-picture + animated FanDuel/HardRock chips, line numbers ticking
       - Scene 3 "FIND" : Spike + parlay-card mock with one leg pulsing green
       - Scene 4 "ONE CHAT" : Spike full-bleed + giant kinetic caption
       - Scene 5 "CTA"  : parlayfarm.com lockup + Spike avatar badge
       Persistent layer: dark mesh gradient + grain + cyan/lime accent slashes
       Captions: ElevenLabs word timings → per-word highlight, Bebas Neue display, IBM Plex body
5. Render twice from same Remotion project (different Composition IDs):
       composition "spike_9x16" 1080x1920
       composition "spike_1x1"  1080x1080
       → /mnt/documents/spike-promo-9x16.mp4
       → /mnt/documents/spike-promo-1x1.mp4
6. QA: extract 4 stills per video, verify captions/avatar visible, no clipping
```

## Files (all under `/tmp` + `/mnt/documents`, no project source edits)

- `/tmp/spike-promo/script.json` — script + scene slicing
- `/tmp/spike-promo/generate-vo.mjs` — ElevenLabs call
- `/tmp/spike-promo/render-avatar.mjs` — HeyGen submit + poll + download (both dims)
- `/tmp/spike-promo/remotion/` — Remotion project (`src/Root.tsx`, `MainVideo.tsx`, 5 scenes, captions)
- `/tmp/spike-promo/render.mjs` — programmatic Remotion render (musl compositor fix per skill)

## Visual direction (streetwise hype)
- Palette: bg `#08090c`, primary lime `#c6ff3a`, accent cyan `#22d3ee`, danger red `#ff3b3b`, text `#f5f5f5`
- Fonts: **Bebas Neue** (display, all-caps), **IBM Plex Sans** (body/chips)
- Motion: snappy springs `{damping:18,stiffness:240}`, 4-6 frame entrances, hard cuts between scenes (no fades), per-word caption pop, subtle camera shake on Scene 2 chips
- Motifs: diagonal slash dividers, ticker tape, glitch flash on cuts (~2 frames)

## Secrets used (already configured)
- `ELEVENLABS_API_KEY`
- `HEYGEN_API_KEY`, `HEYGEN_DOG_AVATAR_ID`

If `HEYGEN_DOG_AVATAR_ID` is missing/empty, I'll stop and ask before continuing — the streetwise hype look needs the real avatar, not the CSS fallback.

## Deliverables
- `/mnt/documents/spike-promo-9x16.mp4` (Reels/Stories)
- `/mnt/documents/spike-promo-1x1.mp4` (feed)
- Posted as `<presentation-artifact>` tags so you can download directly.

## Out of scope
- No changes to the live app, parlay engine, TikTok pipeline, or DB.
- No auto-posting to Instagram (Blotato is TikTok-only here). I'll hand you the MP4s.