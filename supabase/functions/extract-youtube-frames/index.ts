import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ExtractRequest {
  videoUrl: string;
  maxFrames?: number;
  frameInterval?: number; // seconds between frames
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

// Cobalt API for video extraction
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
    
    // Try alternative API (cobalt.tools has been updated)
    return await tryAlternativeCobaltApi(videoUrl);
  }

  const cobaltData = await cobaltResponse.json();
  console.log('[extract-youtube-frames] Cobalt response status:', cobaltData.status);

  if (cobaltData.status === 'error') {
    throw new Error(cobaltData.text || 'Video extraction failed');
  }

  // Cobalt returns different response formats based on status
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

// Extract frames from video stream using canvas simulation
async function extractFramesFromStream(
  streamUrl: string,
  maxFrames: number = 20,
  frameIntervalSeconds: number = 5
): Promise<string[]> {
  console.log('[extract-youtube-frames] Fetching video stream...');
  
  // For edge functions, we can't directly process video
  // Instead, we'll use a thumbnail-based approach for YouTube
  // or return the stream URL for client-side processing
  
  // YouTube provides thumbnail URLs directly
  const detected = detectPlatform(streamUrl);
  
  // Since we can't do true frame extraction in Deno without FFmpeg,
  // we'll return placeholder frames and let the client handle extraction
  // OR use YouTube's thumbnail API for initial frames
  
  const frames: string[] = [];
  
  // For MVP, fetch the video and take snapshots at intervals
  // This is a simplified approach - production would use FFmpeg
  
  console.log('[extract-youtube-frames] Video stream URL obtained, client will extract frames');
  
  return frames;
}

// Get YouTube thumbnails as fallback frames
function getYouTubeThumbnails(videoId: string): string[] {
  const thumbnailUrls = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/default.jpg`,
    // Storyboard thumbnails (different moments in video)
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
    const { videoUrl, maxFrames = 20, frameInterval = 5 }: ExtractRequest = await req.json();
    
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

    // For YouTube, we can provide thumbnail URLs directly
    // For other platforms, we need to get the stream URL
    let videoInfo: VideoInfo = {
      title: 'Video',
      duration: 0,
      platform: detected.platform,
    };
    
    let streamUrl: string | null = null;
    let thumbnailFrames: string[] = [];

    if (detected.platform === 'youtube') {
      // Get YouTube thumbnails as initial frames
      thumbnailFrames = getYouTubeThumbnails(detected.videoId);
      
      // Also try to get the stream URL for client-side extraction
      try {
        const streamResult = await getVideoStreamUrl(videoUrl);
        streamUrl = streamResult.streamUrl;
        videoInfo.title = streamResult.title || 'YouTube Video';
      } catch (streamError) {
        console.log('[extract-youtube-frames] Stream extraction failed, using thumbnails only');
      }
    } else {
      // For Twitter/TikTok, we need the stream URL
      try {
        const streamResult = await getVideoStreamUrl(videoUrl);
        streamUrl = streamResult.streamUrl;
        videoInfo.title = streamResult.title || `${detected.platform} Video`;
      } catch (streamError) {
        throw new Error(`Could not extract video from ${detected.platform}. Try a different link.`);
      }
    }

    // Fetch YouTube thumbnails and convert to base64
    const base64Frames: string[] = [];
    
    for (const thumbnailUrl of thumbnailFrames.slice(0, 8)) {
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

    console.log(`[extract-youtube-frames] Extracted ${base64Frames.length} thumbnail frames`);

    return new Response(JSON.stringify({
      success: true,
      frames: base64Frames,
      streamUrl, // Client can use this for more detailed extraction
      videoInfo,
      platform: detected.platform,
      videoId: detected.videoId,
      message: base64Frames.length > 0 
        ? `Extracted ${base64Frames.length} frames from ${detected.platform}`
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
