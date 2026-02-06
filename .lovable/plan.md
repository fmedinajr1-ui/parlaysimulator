

# Full Video Frame Extraction Enhancement

## Problem Summary

The current system **does not analyze the whole video**:

| Source | Current Behavior | Problem |
|--------|------------------|---------|
| **Local Upload** | Max 30 frames, 1 sec interval | 2-minute video = only 30 frames (covers 30 seconds) |
| **YouTube Link** | Only fetches 8 static thumbnails | Not actual video content - just preview images |
| **Twitter/TikTok** | Returns stream URL but doesn't extract | No frames extracted at all |

For accurate player tracking (jersey ID, rotations, shot chart, defensive matchups), we need **dense frame coverage across the entire video duration**.

---

## Solution: Client-Side Full Video Extraction

Since edge functions can't run FFmpeg, we must extract frames **client-side** using the browser's video element and canvas. This works for:
- Direct file uploads (already partially working)
- YouTube/Twitter/TikTok via the stream URL returned by `extract-youtube-frames`

### New Flow

```text
CURRENT:
  YouTube → Edge Function → 8 static thumbnails → AI

NEW:
  YouTube → Edge Function → Get stream URL
                              ↓
          Client downloads video stream
                              ↓
          Client extracts frames every 2-3 seconds
                              ↓
          60+ frames for full coverage → AI
```

---

## Technical Implementation

### 1. Increase Frame Extraction Limits

**File: `src/lib/video-frame-extractor.ts`**

```typescript
// OLD
const FRAME_INTERVAL_SECONDS = 1;
const MAX_FRAMES = 30;

// NEW - Extract frames throughout entire video
const DEFAULT_FRAME_INTERVAL = 2; // 1 frame every 2 seconds
const MAX_FRAMES = 60; // Up to 60 frames per video
const MIN_FRAMES_PER_MINUTE = 20; // At least 20 frames per minute of video
```

Update `extractFramesFromVideo` to dynamically calculate interval:
```typescript
// Calculate frame interval based on video duration
// Goal: Extract frames evenly across entire video
const targetFrameCount = Math.min(
  MAX_FRAMES,
  Math.max(20, Math.ceil(duration * MIN_FRAMES_PER_MINUTE / 60))
);
const frameInterval = duration / targetFrameCount;
```

### 2. Add Stream URL Video Extraction

**File: `src/lib/video-frame-extractor.ts`**

New function to extract frames from a remote video URL (the stream URL returned by edge function):

```typescript
export async function extractFramesFromUrl(
  videoUrl: string,
  onProgress?: (progress: ExtractionProgress) => void
): Promise<ExtractionResult> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    
    // ... same canvas/extraction logic as file upload
    // but using URL directly instead of createObjectURL
    
    video.src = videoUrl;
    video.load();
  });
}
```

### 3. Update FilmProfileUpload to Use Stream URL

**File: `src/components/scout/FilmProfileUpload.tsx`**

When YouTube/social link is provided:
1. Call `extract-youtube-frames` to get stream URL
2. Use new `extractFramesFromUrl()` to extract actual frames from the video
3. Fall back to thumbnails only if stream extraction fails

```typescript
const handleYouTubeFrames = useCallback(async (
  thumbnails: string[], 
  videoInfo: VideoInfo,
  streamUrl?: string
) => {
  // If we have a stream URL, extract real frames from the video
  if (streamUrl) {
    try {
      setIsProcessingYouTube(true);
      setExtractionProgress({
        stage: 'extracting',
        message: 'Extracting frames from video...',
      });
      
      const result = await extractFramesFromUrl(streamUrl, setExtractionProgress);
      const uniqueFrames = deduplicateFrames(result.frames);
      
      setExtractedFrames(uniqueFrames.map(f => f.base64));
      setPreviewFrames(uniqueFrames.slice(0, 4).map(f => f.base64));
      
      toast({
        title: "Full Video Analyzed",
        description: `Extracted ${uniqueFrames.length} frames from ${videoInfo.platform}`,
      });
      return;
    } catch (err) {
      console.warn('Stream extraction failed, using thumbnails');
    } finally {
      setIsProcessingYouTube(false);
    }
  }
  
  // Fallback to thumbnails
  setExtractedFrames(thumbnails);
  setPreviewFrames(thumbnails.slice(0, 4));
}, [toast]);
```

### 4. Update YouTubeLinkInput Component

Pass `streamUrl` to the callback so `FilmProfileUpload` can use it:

```typescript
// In YouTubeLinkInput.tsx
onFramesExtracted?.(
  data.frames || [],
  { title: data.videoInfo?.title, platform: data.platform },
  data.streamUrl // NEW: Pass stream URL for client-side extraction
);
```

---

## Frame Distribution Strategy

For accurate player tracking, frames should be distributed evenly across the entire video:

| Video Duration | Target Frames | Interval | Coverage |
|----------------|---------------|----------|----------|
| 30 seconds | 15 frames | 2s | Full |
| 1 minute | 30 frames | 2s | Full |
| 2 minutes | 60 frames | 2s | Full |
| 5 minutes | 60 frames | 5s | Full (capped) |

This ensures:
- **Rotations are captured** - Player stints, bench time visible
- **Shot attempts tracked** - Multiple frames around shot clock
- **Defensive matchups** - See who guards who across possessions
- **Fatigue signals** - Track movement quality over time

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/video-frame-extractor.ts` | Increase MAX_FRAMES, add dynamic interval calculation, add `extractFramesFromUrl()` function |
| `src/components/scout/FilmProfileUpload.tsx` | Use stream URL for full extraction, update `handleYouTubeFrames` |
| `src/components/scout/YouTubeLinkInput.tsx` | Pass stream URL to callback |

---

## Expected Outcome

After implementation:
- 2-minute video = **60 frames** extracted (vs current 8 thumbnails)
- Frames are evenly distributed across entire video duration
- Player tracking has enough data to detect:
  - Jersey movements across the court over time
  - Rotation patterns (on/off court)
  - Multiple shot attempts
  - Defensive assignment changes
- AI receives comprehensive visual data for accurate profiling

---

## Limitations & Notes

- **CORS**: Stream URLs from Cobalt may have CORS restrictions - we'll need to test
- **Video size**: Large videos (5+ min) will be capped at 60 frames to avoid memory issues
- **Mobile**: Frame extraction is memory-intensive; we'll maintain 60-frame limit
- **Fallback**: If stream extraction fails, system falls back to thumbnails


