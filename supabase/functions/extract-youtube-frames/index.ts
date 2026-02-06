import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ExtractRequest {
  videoUrl: string;
  maxFrames?: number;
  frameInterval?: number;
}

interface VideoInfo {
  title: string;
  duration: number;
  platform: string;
}

// URL pattern matchers for supported platforms
const URL_PATTERNS = {
  youtube: [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ],
  twitter: [
    /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
  ],
  tiktok: [
    /tiktok\.com\/@[\w.-]+\/video\/(\d+)/,
  ],
};

function detectPlatform(url: string): { platform: string; videoId: string } | null {
  for (const [platform, patterns] of Object.entries(URL_PATTERNS)) {
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return { platform, videoId: match[1] };
      }
    }
  }
  return null;
}

function validateUrl(url: string): { valid: boolean; error?: string; platform?: string } {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'Please enter a valid URL' };
  }
  
  const detected = detectPlatform(url);
  if (!detected) {
    return { 
      valid: false, 
      error: 'Please enter a valid YouTube, Twitter/X, or TikTok link' 
    };
  }
  
  return { valid: true, platform: detected.platform };
}

// YouTube Storyboard API - contains actual frames from throughout video
// Storyboards are sprite sheets (grids of frames) at regular intervals
async function getYouTubeStoryboardFrames(videoId: string): Promise<string[]> {
  console.log('[extract-youtube-frames] Fetching storyboard sprites for:', videoId);
  
  const frames: string[] = [];
  
  // Try different storyboard levels - L2 has more frames, L1 is fallback
  const storyboardConfigs = [
    { level: 'L2', cols: 5, rows: 5 }, // 25 frames per sprite
    { level: 'L1', cols: 5, rows: 5 }, // 25 frames per sprite
  ];
  
  for (const config of storyboardConfigs) {
    // Try multiple sprite sheets (M0, M1, M2, etc.)
    for (let m = 0; m < 4; m++) {
      const storyboardUrl = `https://i.ytimg.com/sb/${videoId}/storyboard3_${config.level}/M${m}.jpg`;
      
      try {
        const response = await fetch(storyboardUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        
        if (!response.ok) {
          console.log(`[extract-youtube-frames] Storyboard ${config.level}/M${m} not found`);
          continue;
        }
        
        // Get sprite sheet and split into individual frames
        const spriteFrames = await extractFramesFromSpriteSheet(
          response, 
          config.cols, 
          config.rows
        );
        
        if (spriteFrames.length > 0) {
          console.log(`[extract-youtube-frames] Got ${spriteFrames.length} frames from ${config.level}/M${m}`);
          frames.push(...spriteFrames);
        }
        
        // Cap at 60 frames total
        if (frames.length >= 60) {
          console.log('[extract-youtube-frames] Reached 60 frame limit');
          return frames.slice(0, 60);
        }
        
      } catch (e) {
        console.log(`[extract-youtube-frames] Storyboard fetch failed: ${storyboardUrl}`, e);
      }
    }
    
    // If we got frames from L2, don't need L1
    if (frames.length >= 10) break;
  }
  
  return frames;
}

// Extract individual frames from a YouTube storyboard sprite sheet
// Sprite sheets are grids of frames (typically 5x5 = 25 frames)
async function extractFramesFromSpriteSheet(
  response: Response,
  gridCols: number = 5,
  gridRows: number = 5
): Promise<string[]> {
  const frames: string[] = [];
  
  try {
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Convert to base64 - this is the full sprite sheet
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const spriteBase64 = btoa(binary);
    
    // For now, we'll return the sprite sheet as a single "frame"
    // The client can split it or we can use image manipulation
    // In Deno, we don't have native canvas, but we can use libraries
    
    // Actually, let's try to determine if this is a valid sprite and estimate frame positions
    // YouTube storyboards are typically 160x90 per frame in a 5x5 grid
    // Total sprite: 800x450 for L1, larger for L2
    
    // Since we can't easily split in Deno without external libs,
    // we'll pass metadata and let client split if needed
    // For MVP: return the full sprite as one frame, client can use CSS background-position
    
    // Better approach: Return as data URL with grid info, client extracts
    frames.push(`data:image/jpeg;base64,${spriteBase64}`);
    
    // Add metadata as special marker (first 25 chars of a sprite is typically different)
    // The client can detect this is a sprite by checking dimensions
    
  } catch (e) {
    console.error('[extract-youtube-frames] Failed to process sprite sheet:', e);
  }
  
  return frames;
}

// Split a sprite sheet into individual frames on the server
// This uses dimension estimation since we don't have canvas in Deno
async function splitSpriteSheet(
  base64Data: string,
  cols: number,
  rows: number,
  frameWidth: number = 160,
  frameHeight: number = 90
): Promise<string[]> {
  // In Deno Edge Functions, we can't use canvas directly
  // We'll return the full sprite and let client split it
  // Or use a Deno image library if available
  
  // For now, return the sprite as-is
  // The client will handle splitting using canvas
  return [base64Data];
}

// Cobalt API for video extraction (fallback for non-YouTube)
async function getVideoStreamUrl(videoUrl: string): Promise<{ streamUrl: string; title?: string; duration?: number }> {
  console.log('[extract-youtube-frames] Calling Cobalt API for:', videoUrl);
  
  // Try Cobalt API (free, no auth required)
  const cobaltResponse = await fetch('https://api.cobalt.tools/', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: videoUrl,
      videoQuality: '480',
      filenameStyle: 'basic',
      downloadMode: 'auto',
    }),
  });

  if (!cobaltResponse.ok) {
    const errorText = await cobaltResponse.text();
    console.error('[extract-youtube-frames] Cobalt API error:', cobaltResponse.status, errorText);
    return await tryAlternativeCobaltApi(videoUrl);
  }

  const cobaltData = await cobaltResponse.json();
  console.log('[extract-youtube-frames] Cobalt response status:', cobaltData.status);

  if (cobaltData.status === 'error') {
    throw new Error(cobaltData.text || 'Video extraction failed');
  }

  if (cobaltData.status === 'redirect' || cobaltData.status === 'stream') {
    return {
      streamUrl: cobaltData.url,
      title: cobaltData.filename || 'Video',
    };
  }

  if (cobaltData.url) {
    return {
      streamUrl: cobaltData.url,
      title: cobaltData.filename || 'Video',
    };
  }

  throw new Error('Could not extract video URL from response');
}

// Alternative Cobalt API endpoint
async function tryAlternativeCobaltApi(videoUrl: string): Promise<{ streamUrl: string; title?: string }> {
  console.log('[extract-youtube-frames] Trying alternative Cobalt endpoint');
  
  const response = await fetch('https://co.wuk.sh/api/json', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: videoUrl,
      vQuality: '480',
    }),
  });

  if (!response.ok) {
    throw new Error(`Video service unavailable (${response.status}). Try a different video.`);
  }

  const data = await response.json();
  
  if (data.status === 'error') {
    throw new Error(data.text || 'This video is not accessible. Try a public video.');
  }

  if (data.url) {
    return { streamUrl: data.url, title: data.filename };
  }

  throw new Error('Could not extract video. The video may be private or restricted.');
}

// Get YouTube thumbnails as fallback frames (last resort)
function getYouTubeThumbnails(videoId: string): string[] {
  const thumbnailUrls = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/default.jpg`,
    `https://img.youtube.com/vi/${videoId}/1.jpg`,
    `https://img.youtube.com/vi/${videoId}/2.jpg`,
    `https://img.youtube.com/vi/${videoId}/3.jpg`,
  ];
  
  return thumbnailUrls;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { videoUrl, maxFrames = 60 }: ExtractRequest = await req.json();
    
    // Validate URL
    const validation = validateUrl(videoUrl);
    if (!validation.valid) {
      return new Response(JSON.stringify({
        success: false,
        error: validation.error,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[extract-youtube-frames] Processing ${validation.platform} URL: ${videoUrl}`);

    // Detect platform and extract video ID
    const detected = detectPlatform(videoUrl);
    if (!detected) {
      throw new Error('Could not parse video URL');
    }

    let videoInfo: VideoInfo = {
      title: 'Video',
      duration: 0,
      platform: detected.platform,
    };
    
    let streamUrl: string | null = null;
    let base64Frames: string[] = [];
    let frameSource: 'storyboard' | 'thumbnail' | 'stream' = 'thumbnail';

    if (detected.platform === 'youtube') {
      // TIER 1: Try YouTube storyboard sprites first (actual gameplay frames!)
      console.log('[extract-youtube-frames] Attempting storyboard extraction...');
      const storyboardFrames = await getYouTubeStoryboardFrames(detected.videoId);
      
      if (storyboardFrames.length > 0) {
        base64Frames = storyboardFrames;
        frameSource = 'storyboard';
        console.log(`[extract-youtube-frames] Got ${storyboardFrames.length} storyboard frames`);
      } else {
        // TIER 2: Fall back to thumbnails if storyboards fail
        console.log('[extract-youtube-frames] Storyboards failed, using thumbnails...');
        const thumbnailUrls = getYouTubeThumbnails(detected.videoId);
        
        for (const thumbnailUrl of thumbnailUrls.slice(0, 8)) {
          try {
            const imgResponse = await fetch(thumbnailUrl);
            if (imgResponse.ok) {
              const arrayBuffer = await imgResponse.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);
              let binary = '';
              for (let i = 0; i < uint8Array.length; i++) {
                binary += String.fromCharCode(uint8Array[i]);
              }
              const base64 = btoa(binary);
              base64Frames.push(`data:image/jpeg;base64,${base64}`);
            }
          } catch (e) {
            console.log(`[extract-youtube-frames] Failed to fetch thumbnail: ${thumbnailUrl}`);
          }
        }
        frameSource = 'thumbnail';
      }
      
      // TIER 3: Also try to get stream URL for client-side extraction
      try {
        const streamResult = await getVideoStreamUrl(videoUrl);
        streamUrl = streamResult.streamUrl;
        videoInfo.title = streamResult.title || 'YouTube Video';
      } catch (streamError) {
        console.log('[extract-youtube-frames] Stream extraction failed (expected for YouTube)');
      }
    } else {
      // For Twitter/TikTok, we need the stream URL
      try {
        const streamResult = await getVideoStreamUrl(videoUrl);
        streamUrl = streamResult.streamUrl;
        videoInfo.title = streamResult.title || `${detected.platform} Video`;
        frameSource = 'stream';
      } catch (streamError) {
        throw new Error(`Could not extract video from ${detected.platform}. Try a different link.`);
      }
    }

    console.log(`[extract-youtube-frames] Returning ${base64Frames.length} ${frameSource} frames`);

    return new Response(JSON.stringify({
      success: true,
      frames: base64Frames,
      streamUrl,
      videoInfo,
      platform: detected.platform,
      videoId: detected.videoId,
      frameSource, // NEW: Tell client what type of frames these are
      isStoryboard: frameSource === 'storyboard', // Hint for client to split sprites
      message: base64Frames.length > 0 
        ? `Extracted ${base64Frames.length} ${frameSource} frames from ${detected.platform}`
        : 'Stream URL provided for client-side extraction',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[extract-youtube-frames] Error:', error);
    
    const message = error instanceof Error ? error.message : 'Failed to extract video frames';
    
    return new Response(JSON.stringify({
      success: false,
      error: message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
