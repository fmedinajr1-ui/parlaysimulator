

# Fix Video Frame Extraction: Analyze Actual Gameplay, Not Thumbnails

## Problem Identified

Your screenshot shows the core issue:
- **8 identical thumbnail frames** - all showing the same "FULL GAME HIGHLIGHTS" title card
- **No tracking data** - because the AI is analyzing title cards, not actual gameplay footage
- All player tracking returns empty because players aren't visible in thumbnails

### Why This Happens

| What Should Happen | What Actually Happens |
|-------------------|----------------------|
| Extract 60 frames from throughout video | Get 8 YouTube thumbnail variations (all same image) |
| Stream URL used for client-side extraction | CORS blocks Cobalt stream URLs, fallback to thumbnails |
| AI sees players, jerseys, court positions | AI sees only "FULL GAME HIGHLIGHTS" text overlay |

---

## Solution: Multi-Tier Frame Extraction

### Tier 1: YouTube Storyboard Sprites (Primary for YouTube)

YouTube generates **storyboard sprite sheets** containing many frames from throughout videos. These bypass the thumbnail limitation:

```text
OLD: img.youtube.com/vi/{id}/maxresdefault.jpg → Same title card image
NEW: i.ytimg.com/sb/{id}/storyboard3_L1/M$M.jpg → Actual frames from video
```

### Tier 2: Edge Function Proxied Extraction

For Twitter/TikTok (or when storyboards fail), proxy the stream through the edge function:
1. Edge function downloads video stream
2. Use `ffprobe`-like logic to extract frame timestamps
3. Fetch frame snapshots at intervals server-side
4. Return actual base64 frames (not thumbnail URLs)

### Tier 3: Enhanced Error Messaging

When extraction returns identical frames, warn the user clearly:
- "Detected title card only - try a different video link"
- "For best results, use game highlight clips that show actual gameplay"

---

## Technical Implementation

### 1. Add YouTube Storyboard Extraction (Edge Function)

Update `extract-youtube-frames/index.ts` to fetch YouTube storyboard sprites:

```typescript
// YouTube Storyboard API - contains actual frames from throughout video
async function getYouTubeStoryboardFrames(videoId: string): Promise<string[]> {
  const frames: string[] = [];
  
  // Try to get storyboard manifest from YouTube
  // Storyboards are sprite sheets with frames at regular intervals
  const storyboardUrls = [
    // L2 storyboards have more frames
    `https://i.ytimg.com/sb/${videoId}/storyboard3_L2/M0.jpg`,
    `https://i.ytimg.com/sb/${videoId}/storyboard3_L2/M1.jpg`,
    `https://i.ytimg.com/sb/${videoId}/storyboard3_L2/M2.jpg`,
    // L1 storyboards as fallback
    `https://i.ytimg.com/sb/${videoId}/storyboard3_L1/M0.jpg`,
    `https://i.ytimg.com/sb/${videoId}/storyboard3_L1/M1.jpg`,
  ];
  
  for (const url of storyboardUrls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        // Storyboard is a sprite sheet - extract individual frames
        const spriteFrames = await extractFramesFromSpriteSheet(response);
        frames.push(...spriteFrames);
      }
    } catch (e) {
      console.log(`Storyboard fetch failed: ${url}`);
    }
  }
  
  return frames;
}
```

### 2. Extract Individual Frames from Sprite Sheets

YouTube storyboards are grids (typically 5x5 or 10x10 frames). Parse them:

```typescript
async function extractFramesFromSpriteSheet(
  response: Response,
  gridCols: number = 5,
  gridRows: number = 5
): Promise<string[]> {
  // Get sprite sheet as image data
  const arrayBuffer = await response.arrayBuffer();
  
  // In Deno, we'd use image processing to split the grid
  // Each cell is one frame from the video
  // Return array of base64 individual frames
}
```

### 3. Client-Side: Detect Duplicate Frames

Update `FilmProfileUpload.tsx` to warn when all frames look identical:

```typescript
// After frame extraction, check for duplicates
const uniqueCheck = deduplicateFrames(result.frames);
if (uniqueCheck.length <= 2 && result.frames.length >= 6) {
  toast({
    title: "Warning: Thumbnail Only",
    description: "Could only get video thumbnails, not actual frames. Try a different video.",
    variant: "destructive",
  });
}
```

### 4. Better UX: Show What's Being Analyzed

Update the UI to clearly show:
- Source type: "Thumbnails" vs "Full Video Frames"
- Frame uniqueness: "8 frames (all unique)" vs "8 frames (duplicates detected)"
- Clear guidance when analysis won't work

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/extract-youtube-frames/index.ts` | Add YouTube storyboard API extraction, sprite sheet parsing, remove duplicate thumbnail fetching |
| `src/components/scout/FilmProfileUpload.tsx` | Duplicate frame detection warning, better progress messaging |
| `src/lib/video-frame-extractor.ts` | Add duplicate detection utility that's more strict |

---

## New YouTube Storyboard Flow

```text
User pastes YouTube link
         ↓
Edge function extracts video ID
         ↓
Fetch YouTube storyboard sprites (L2 first, then L1)
         ↓
Parse sprite sheets into individual frames (25-100 frames)
         ↓
Return actual gameplay frames to client
         ↓
AI analyzes real game footage with player visibility
         ↓
Jersey tracking, court zones, shots all detected
```

---

## Expected Outcome

After implementation:
- YouTube highlights → **25-60 actual gameplay frames** (not 8 identical thumbnails)
- Each frame shows different moment from video
- AI can track jersey numbers across frames
- Court zones and shot attempts visible in footage
- Player tracking data populated correctly

---

## Alternative: Local Upload Works Better

As a workaround, **local video upload** already extracts real frames:
- User downloads YouTube video (via browser extension or online tool)
- Uploads the .mp4 file directly
- System extracts 60 frames across entire video
- AI gets actual gameplay footage to analyze

The plan above makes YouTube/social links work as expected without requiring downloads.

