

# YouTube Link Support for Player Profile Building - IMPLEMENTED ✅

## Overview

Added the ability to paste YouTube links (NBA highlights, game clips) as an alternative to uploading video files. The system extracts frames from the YouTube video and feeds them into the player behavior profile pipeline.

## Implementation Status

| Component | Status |
|-----------|--------|
| `extract-youtube-frames` edge function | ✅ Complete |
| `YouTubeLinkInput.tsx` component | ✅ Complete |
| `FilmProfileUpload.tsx` component | ✅ Complete |
| Scout page integration | ✅ Complete |
| Edge function deployed | ✅ Complete |

YouTube does not provide a direct API for downloading video content. The options are:

| Approach | Feasibility | Notes |
|----------|-------------|-------|
| **yt-dlp** (server-side) | Complex | Requires Deno runtime, binary installation, ~50MB overhead |
| **YouTube Data API** | No | Only metadata, not video content |
| **Third-party APIs** | Best option | Services like RapidAPI, Cobalt, or self-hosted proxies |
| **Client-side extraction** | Impossible | CORS blocks direct YouTube access |

### Recommended: Cobalt API (Free, No Auth Required)

Cobalt is a free, open-source YouTube downloader API that works well for this use case:

```
POST https://api.cobalt.tools/
{
  "url": "https://www.youtube.com/watch?v=...",
  "videoQuality": "480"
}
```

Returns a direct download URL that the edge function can stream and extract frames from.

---

## Implementation Plan

### 1. New Edge Function: `extract-youtube-frames`

**File**: `supabase/functions/extract-youtube-frames/index.ts`

This edge function will:
1. Accept a YouTube URL
2. Call Cobalt API to get a direct video stream URL
3. Download video to temp storage (or stream directly)
4. Extract frames using FFmpeg or frame-by-frame processing
5. Return base64-encoded frames

```typescript
// Simplified flow
interface YouTubeFrameRequest {
  youtubeUrl: string;
  maxFrames?: number;
  frameInterval?: number; // seconds between frames
}

// Response
{
  success: true,
  frames: ["data:image/jpeg;base64,...", ...],
  videoInfo: {
    title: "Anthony Edwards 42 Points vs Lakers",
    duration: 245, // seconds
  }
}
```

### 2. Update Frontend Components

#### A. Modify `FilmProfileUpload.tsx` (New Component)

Add a tabbed interface with two input methods:

```text
┌────────────────────────────────────────────────────────────────┐
│ 📹 Build Player Profile from Film                              │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [🔍 Search player... Anthony Edwards              ▼]          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │ 📤 Upload    │  │ 🔗 YouTube   │  ← Toggle between tabs      │
│  └──────────────┘  └──────────────┘                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Paste YouTube link                                        │  │
│  │ https://youtube.com/watch?v=...                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  💡 Tips:                                                       │
│  • Works with YouTube, Twitter/X, and TikTok links             │
│  • Best for highlights and game clips (1-5 min)                │
│  • Player must be clearly visible in footage                    │
│                                                                 │
│  [      🎬 Extract & Analyze     ]                              │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

#### B. Create `YouTubeLinkInput.tsx`

A reusable component for YouTube URL input with validation:

```tsx
interface YouTubeLinkInputProps {
  onFramesExtracted: (frames: string[], videoInfo: VideoInfo) => void;
  onError: (error: string) => void;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}
```

Features:
- URL validation (YouTube, Twitter/X, TikTok patterns)
- Progress indicator during extraction
- Preview of first 4 extracted frames
- Error handling with user-friendly messages

### 3. Edge Function Details

#### Frame Extraction Strategy

For a 3-minute highlight video:
- Extract 1 frame every 5 seconds = ~36 frames
- Cap at 30 frames maximum (API limits)
- Prefer key moments (start, middle, end distribution)

```typescript
function calculateFrameTimestamps(duration: number, maxFrames = 30): number[] {
  const interval = Math.max(3, duration / maxFrames);
  const timestamps: number[] = [];
  
  for (let t = 0; t < duration && timestamps.length < maxFrames; t += interval) {
    timestamps.push(t);
  }
  
  return timestamps;
}
```

#### Video Info Extraction

Parse video metadata to help with context:
- Title → May contain player names, game info
- Duration → Determines frame extraction strategy
- Channel → Identify official NBA sources for higher quality

### 4. Integration with Profile System

The extracted frames flow into the existing profile pipeline:

```text
YouTube URL
    ↓
extract-youtube-frames (edge function)
    ↓
[base64 frames]
    ↓
update-player-profile-from-film (existing)
    ↓
player_behavior_profiles (database)
```

### 5. URL Pattern Support

Support multiple video platforms:

| Platform | Pattern | Notes |
|----------|---------|-------|
| YouTube | `youtube.com/watch?v=`, `youtu.be/` | Primary target |
| YouTube Shorts | `youtube.com/shorts/` | Short-form clips |
| Twitter/X | `twitter.com/*/status/`, `x.com/*/status/` | Game clips posted by reporters |
| TikTok | `tiktok.com/@*/video/` | Highlight compilations |

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/extract-youtube-frames/index.ts` | YouTube → frames extraction |
| `src/components/scout/YouTubeLinkInput.tsx` | URL input component |
| `src/components/scout/FilmProfileUpload.tsx` | Combined upload/YouTube UI |

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/config.toml` | Register new edge function |
| `src/pages/SweetSpots.tsx` | Add film profile upload section |
| `src/components/scout/index.ts` | Export new components |

---

## Error Handling

| Scenario | User Message |
|----------|--------------|
| Invalid URL | "Please enter a valid YouTube, Twitter, or TikTok link" |
| Video too long (>10 min) | "Video is too long. Try a clip under 10 minutes" |
| Private/restricted video | "This video is not accessible. Try a public video" |
| API rate limit | "Too many requests. Please try again in a few minutes" |
| Extraction failed | "Could not extract frames. Try a different video" |

---

## Cobalt API Alternative: Self-Hosted Option

If Cobalt API has reliability issues, can self-host using:

1. **Cloudflare Worker** with yt-dlp WASM build
2. **Dedicated microservice** running yt-dlp + FFmpeg
3. **RapidAPI** YouTube downloader endpoints (paid but reliable)

For MVP, start with Cobalt API and add fallbacks as needed.

---

## Data Flow Diagram

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                     YOUTUBE → PLAYER PROFILE FLOW                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐                                                    │
│  │ User pastes      │                                                    │
│  │ YouTube URL      │                                                    │
│  └────────┬─────────┘                                                    │
│           │                                                              │
│           ▼                                                              │
│  ┌──────────────────┐    ┌─────────────────────┐                        │
│  │ YouTubeLinkInput │───→│ extract-youtube-    │                        │
│  │ Component        │    │ frames (Edge Fn)    │                        │
│  └──────────────────┘    └──────────┬──────────┘                        │
│                                     │                                    │
│                                     │ 1. Call Cobalt API                 │
│                                     │ 2. Get video stream                │
│                                     │ 3. Extract frames                  │
│                                     │ 4. Encode as base64                │
│                                     ▼                                    │
│                          ┌──────────────────────┐                        │
│                          │ [base64 frames]      │                        │
│                          └──────────┬───────────┘                        │
│                                     │                                    │
│                                     ▼                                    │
│  ┌──────────────────┐    ┌─────────────────────┐                        │
│  │ FilmProfileUpload│───→│ update-player-      │                        │
│  │ + Player Select  │    │ profile-from-film   │                        │
│  └──────────────────┘    └──────────┬──────────┘                        │
│                                     │                                    │
│                                     │ AI vision analysis                 │
│                                     ▼                                    │
│                          ┌──────────────────────┐                        │
│                          │ player_behavior_     │                        │
│                          │ profiles (DB)        │                        │
│                          └──────────────────────┘                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Priority

1. **Edge Function**: `extract-youtube-frames` (core functionality)
2. **Component**: `YouTubeLinkInput.tsx` (URL input + validation)
3. **Component**: `FilmProfileUpload.tsx` (tabbed upload + YouTube UI)
4. **Integration**: Connect to existing profile update pipeline
5. **Page Integration**: Add to Sweet Spots and Scout pages

---

## Expected Outcome

After implementation:
- Users can paste a YouTube link of NBA highlights
- System extracts frames and feeds them to AI vision analysis
- Player behavior profiles are updated with film-derived insights
- No need to manually record and upload video files
- Works with YouTube, Twitter/X, and TikTok game clips

