# Plan — Re-render explainer (sharper Scene 1 + engine-led narrative)

## Problem
The current `/mnt/documents/slip-explainer.mp4` (3.98 MB) was rendered in a previous session and the Remotion source no longer exists in the sandbox (`/tmp` got reset). Two changes are needed:

1. **Scene 1 (drop zone / phone mockup) reads soft** — low contrast between the phone frame, the slip card, and the dotted drop zone. On a phone-sized viewport it looks washed out.
2. **The narrative still leans on "roast"** in the VO + on-screen text. The actual product value is the **cross-reference engine** (Unified Props, Median Lock, Juiced Props, L10 Hit Rates, Sharp Signals, Trap Probability, Injuries, Fatigue) that decides Over vs. Under per leg. The roast was already demoted to flavor in the analyzer itself — the video should match.

## What Will Change

### 1. Scaffold a fresh Remotion project at `worker/explainer/`
Separate from `worker/remotion/` (which is the TikTok render pipeline — different compositions, props, audio timings). Keeps the explainer source version-controlled in the repo so future re-renders don't depend on `/tmp`.

Structure:
```text
worker/explainer/
  package.json
  tsconfig.json
  scripts/render.mjs          # programmatic render → /mnt/documents/slip-explainer_v2.mp4
  public/voiceover.mp3        # generated via Lovable AI / ElevenLabs at build
  src/
    index.ts                  # registerRoot
    Root.tsx                  # single Composition "explainer", 1080x1920, 30fps
    MainVideo.tsx             # TransitionSeries wiring 5 scenes + persistent BG
    scenes/
      Scene1_DropZone.tsx     # ← rebuilt with tighter contrast
      Scene2_EngineFanout.tsx # ← rewritten: 8 engines cross-reference, no roast
      Scene3_OverUnderCall.tsx# ← new framing: per-leg Over/Under verdict
      Scene4_SwapSuggestion.tsx
      Scene5_BroadcastCTA.tsx # admin-only one-tap broadcast button
    components/
      PhoneMockup.tsx         # shared device chrome (used in S1, S5)
      EngineChip.tsx
      VerdictPill.tsx
```

### 2. Scene 1 contrast pass (the main visual fix)
Concrete adjustments to `PhoneMockup` + `Scene1_DropZone`:

- Phone frame: bump bezel from `#1a1a1a` to **pure `#0a0a0a`** with a 2px inner highlight `rgba(255,255,255,0.08)` so the device pops off the gradient background.
- Drop zone: dotted border weight `1px → 2.5px`, color `border-muted/30 → border-neon-cyan/70`, fill `bg-card/40 → bg-[#0d1620]` (solid panel, not translucent).
- "Drop your slip here" label: `text-muted-foreground → text-white`, weight `500 → 700`, add a `text-shadow: 0 1px 2px rgba(0,0,0,0.6)` for legibility on the gradient.
- Add a soft inner glow ring (`box-shadow: inset 0 0 32px rgba(0,255,200,0.12)`) that pulses on a 60-frame sine so the eye is drawn there without the existing "scan beam" effect overpowering the panel.
- Slip card (the screenshot dropping in): bump shadow `shadow-lg → shadow-2xl` + add `ring-1 ring-white/15` so the card edge is visible against the dark phone.
- Background gradient: shift midstop from `#0f1420` to `#080d18` to widen the contrast envelope behind the phone.

### 3. Voiceover + on-screen copy rewrite (remove "roast", lead with engines)
New script (≈28 s, drives all 5 scene durations):

| # | Scene | VO | On-screen |
|---|---|---|---|
| 1 | Drop zone | "Drop any parlay slip — screenshot or text." | "DROP. SCAN. DECIDE." |
| 2 | Engine fan-out | "Eight engines cross-reference every leg in parallel — Unified PVS, Median Lock, Juiced Props, L10 hit rates, sharp money, trap probability, injuries, fatigue." | Animated chips for all 8 engines flying into a central node |
| 3 | Over/Under call | "Each leg gets a verdict — keep, swap, or drop — with a sharper Over or Under built from real consensus, not a guess." | Per-leg "OVER 27.5 ✓ KEEP" / "UNDER 6.5 → SWAP" pills stagger in |
| 4 | Swap suggestion | "Weak legs come back with a sharper alternative and a projected EV gain." | Strikethrough of weak leg → arrow → suggested leg with `+11% EV` chip |
| 5 | Admin broadcast | "Approve once. Broadcast to every subscriber in a tap." | Big tappable "BROADCAST" button on the phone, then a ripple of chat bubbles |

**Removed entirely:** every line that referenced "roast", "we'll roast it", "roasted to perfection", and the fire emoji. The CTA text on Scene 5 changes from `"GET ROASTED"` to `"BROADCAST"`. Lower-third stickers swap to engine names.

### 4. Voiceover regeneration
Re-run the existing voiceover step (Lovable AI / ElevenLabs flow already used last render — `LOVABLE_API_KEY` provisioned) against the new script, write `worker/explainer/public/voiceover.mp3`, capture word timings to `worker/explainer/public/voiceover.timings.json`. Captions in Scene captions layer drive off these timings (same alignment pattern as `worker/remotion/src/compositions/VideoComposition.tsx`).

### 5. Render + replace artifact
- Programmatic render via `scripts/render.mjs` (sandbox-safe pattern: `chromeMode: "chrome-for-testing"`, `muted: false` since we want the VO baked in, `concurrency: 1`).
- Output to **`/mnt/documents/slip-explainer_v2.mp4`** (versioned per project rules — keeps the original for comparison).
- QA pass: extract frames at frame 30 (Scene 1 mid), frame 240 (engine fan-out peak), frame 540 (broadcast CTA) via `bunx remotion still`, view each PNG to confirm contrast + that the word "roast" appears nowhere on screen.
- Upload the final MP4 to the existing `marketing-videos` Supabase storage bucket (already created in `20260427141253_*.sql`) under key `slip-explainer-v2.mp4` and update the `bot_video_broadcasts` row source-of-truth so the existing admin "Broadcast" button in `signal-alert-telegram` points at the new asset.

## Technical Details

**Files to create:**
- `worker/explainer/package.json`, `tsconfig.json`, `scripts/render.mjs`
- `worker/explainer/src/index.ts`, `Root.tsx`, `MainVideo.tsx`
- `worker/explainer/src/scenes/Scene1_DropZone.tsx` … `Scene5_BroadcastCTA.tsx`
- `worker/explainer/src/components/PhoneMockup.tsx`, `EngineChip.tsx`, `VerdictPill.tsx`

**Files to edit:**
- `supabase/functions/signal-alert-engine/index.ts` — swap the hardcoded video URL constant from `slip-explainer.mp4` → `slip-explainer-v2.mp4` (both Telegram preview send + broadcast payload).
- `supabase/functions/signal-alert-telegram/index.ts` — same URL swap on the broadcast handler.
- `.lovable/plan.md` — append a short "v2 explainer" note so the next session knows the source lives at `worker/explainer/`.

**Render command:**
```bash
cd worker/explainer && bun install && node scripts/render.mjs
```

**Constraints applied:**
- Stays under 30 s → well within the 600 s `code--exec` ceiling.
- No `backdropFilter` (sandbox Chromium constraint) — Scene 1 inner glow uses `box-shadow inset` instead.
- Fonts: `@remotion/google-fonts/Inter` + `@remotion/google-fonts/SpaceGrotesk` loaded at module scope.
- The current `slip-explainer.mp4` is **not** deleted — kept as `_v1` reference per the iterating-on-artifacts convention.

## Outcome
- Scene 1 reads sharply on a 402×636 viewport: the phone frame, dotted drop zone, and slip card all have clearly distinct edges and the "Drop your slip here" label is high-contrast white on solid dark.
- The whole video reframes the product around the **8-engine cross-reference deciding Over vs. Under per leg** — the word "roast" is gone from VO, captions, and on-screen stickers.
- New asset lands at `/mnt/documents/slip-explainer_v2.mp4` and is wired into the existing admin one-tap broadcast button so a single tap pushes v2 to all subscribers.
