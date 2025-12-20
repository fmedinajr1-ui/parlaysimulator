/**
 * Video frame extraction utility for betting slip recordings
 * Extracts frames from video files for AI analysis
 * Updated for iOS Safari / PWA compatibility
 */

export interface ExtractedFrame {
  index: number;
  base64: string;
  timestamp: number;
}

export interface ExtractionProgress {
  stage: 'loading' | 'extracting' | 'analyzing' | 'complete' | 'error';
  currentFrame: number;
  totalFrames: number;
  message: string;
  legsFound?: number;
}

export interface ExtractionResult {
  frames: ExtractedFrame[];
  duration: number;
  frameCount: number;
}

const MAX_FRAME_DIMENSION = 1280;
const FRAME_INTERVAL_SECONDS = 1;
const MAX_FRAMES = 30;
const JPEG_QUALITY = 0.85;
const FRAME_TIMEOUT_MS = 8000; // 8 second timeout per frame
const SIMILARITY_THRESHOLD = 0.92; // Skip frames that are 92%+ similar

/**
 * Detect if we're on iOS Safari
 */
function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebKit = /WebKit/.test(ua);
  const isChrome = /CriOS/.test(ua);
  return isIOS && isWebKit && !isChrome;
}

/**
 * Extract frames from a video file at regular intervals
 */
export async function extractFramesFromVideo(
  file: File,
  onProgress?: (progress: ExtractionProgress) => void
): Promise<ExtractionResult> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    // Mobile-friendly video attributes
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.autoplay = false;
    video.preload = 'auto'; // Better mobile support
    video.crossOrigin = 'anonymous';

    const cleanup = () => {
      try {
        URL.revokeObjectURL(video.src);
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
        canvas.remove();
      } catch (e) {
        console.warn('Cleanup error:', e);
      }
    };

    // Overall timeout for video loading
    const loadTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Video loading timed out. Try a shorter video or screenshot instead.'));
    }, 30000);

    video.onerror = (e) => {
      clearTimeout(loadTimeout);
      cleanup();
      console.error('Video load error:', e);
      reject(new Error('Failed to load video. Try uploading a screenshot instead.'));
    };

    video.onloadedmetadata = async () => {
      clearTimeout(loadTimeout);
      const duration = video.duration;
      
      if (!duration || duration <= 0 || !isFinite(duration)) {
        cleanup();
        reject(new Error('Invalid video duration. Try a different video or screenshot.'));
        return;
      }

      const frameInterval = Math.max(FRAME_INTERVAL_SECONDS, duration / MAX_FRAMES);
      const totalFrames = Math.min(Math.floor(duration / frameInterval), MAX_FRAMES);

      if (totalFrames < 1) {
        cleanup();
        reject(new Error('Video too short. Try a screenshot instead.'));
        return;
      }

      onProgress?.({
        stage: 'loading',
        currentFrame: 0,
        totalFrames,
        message: `Preparing to extract ${totalFrames} frames...`
      });

      // Set canvas dimensions
      let { videoWidth, videoHeight } = video;
      if (videoWidth > MAX_FRAME_DIMENSION || videoHeight > MAX_FRAME_DIMENSION) {
        if (videoWidth > videoHeight) {
          videoHeight = Math.round((videoHeight * MAX_FRAME_DIMENSION) / videoWidth);
          videoWidth = MAX_FRAME_DIMENSION;
        } else {
          videoWidth = Math.round((videoWidth * MAX_FRAME_DIMENSION) / videoHeight);
          videoHeight = MAX_FRAME_DIMENSION;
        }
      }

      canvas.width = videoWidth;
      canvas.height = videoHeight;

      const frames: ExtractedFrame[] = [];
      
      // Extract frames at each interval
      for (let i = 0; i < totalFrames; i++) {
        const timestamp = i * frameInterval;
        
        onProgress?.({
          stage: 'extracting',
          currentFrame: i + 1,
          totalFrames,
          message: `Extracting frame ${i + 1}/${totalFrames}...`
        });

        try {
          const frame = await extractFrameAtTime(video, canvas, ctx, timestamp, videoWidth, videoHeight);
          frames.push({
            index: i,
            base64: frame,
            timestamp
          });
        } catch (err) {
          console.warn(`Failed to extract frame at ${timestamp}s:`, err);
          // Continue with remaining frames
        }
      }

      cleanup();

      onProgress?.({
        stage: 'complete',
        currentFrame: frames.length,
        totalFrames: frames.length,
        message: `Extracted ${frames.length} frames`
      });

      resolve({
        frames,
        duration,
        frameCount: frames.length
      });
    };

    video.src = URL.createObjectURL(file);
    video.load();
  });
}

/**
 * Extract a single frame at a specific timestamp
 * With iOS Safari compatibility fixes
 */
function extractFrameAtTime(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  timestamp: number,
  width: number,
  height: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const isiOS = isIOSSafari();
    
    // Timeout fallback
    const timeoutId = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      console.warn(`Frame extraction timeout at ${timestamp}s`);
      reject(new Error(`Timeout seeking to ${timestamp}s`));
    }, FRAME_TIMEOUT_MS);

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      
      // iOS Safari fix: Double requestAnimationFrame delay
      // This ensures the video frame is fully decoded before drawing
      const drawFrame = () => {
        clearTimeout(timeoutId);
        
        try {
          // Draw white background then frame
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(video, 0, 0, width, height);
          
          const base64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          
          // Quick check for blank/white frame
          if (isLikelyBlankFrame(base64)) {
            console.warn(`Likely blank frame at ${timestamp}s, retrying...`);
            // Retry once with extra delay
            setTimeout(() => {
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(video, 0, 0, width, height);
              resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
            }, 100);
          } else {
            resolve(base64);
          }
        } catch (drawError) {
          console.error('Draw error:', drawError);
          reject(new Error(`Failed to draw frame at ${timestamp}s`));
        }
      };
      
      if (isiOS) {
        // Triple RAF for iOS Safari
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(drawFrame);
          });
        });
      } else {
        // Double RAF for other browsers
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(drawFrame);
        });
      }
    };

    const onError = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error(`Failed to seek to ${timestamp}s`));
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    
    try {
      video.currentTime = timestamp;
    } catch (e) {
      clearTimeout(timeoutId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error(`Cannot set video time to ${timestamp}s`));
    }
  });
}

/**
 * Quick heuristic to detect likely blank/white frames
 */
function isLikelyBlankFrame(base64: string): boolean {
  // Very short base64 often means blank/white image
  // A typical JPEG with content is at least 5KB
  const dataLength = base64.length - 'data:image/jpeg;base64,'.length;
  return dataLength < 3000;
}

/**
 * Compare two frames to detect if they're nearly identical
 * Uses base64 length and sampling for quick comparison
 */
export function areFramesSimilar(frame1: string, frame2: string, threshold = SIMILARITY_THRESHOLD): boolean {
  // Quick length comparison first
  const len1 = frame1.length;
  const len2 = frame2.length;
  const lengthRatio = Math.min(len1, len2) / Math.max(len1, len2);
  
  // If lengths are very different, frames are definitely different
  if (lengthRatio < 0.85) return false;
  
  // If lengths are very similar, check content samples
  if (lengthRatio > 0.98) {
    // Sample comparison at multiple positions
    const sampleSize = 500;
    const positions = [
      Math.floor(len1 * 0.25),
      Math.floor(len1 * 0.5),
      Math.floor(len1 * 0.75)
    ];
    
    let matchingSamples = 0;
    for (const pos of positions) {
      const sample1 = frame1.substring(pos, pos + sampleSize);
      const sample2 = frame2.substring(pos, pos + sampleSize);
      if (sample1 === sample2) matchingSamples++;
    }
    
    // If 2+ samples match, consider similar
    if (matchingSamples >= 2) return true;
  }
  
  return lengthRatio > threshold;
}

/**
 * Deduplicate frames by removing similar consecutive frames
 */
export function deduplicateFrames(frames: ExtractedFrame[]): ExtractedFrame[] {
  if (frames.length <= 1) return frames;
  
  const uniqueFrames: ExtractedFrame[] = [frames[0]];
  let skippedCount = 0;
  
  for (let i = 1; i < frames.length; i++) {
    const lastUnique = uniqueFrames[uniqueFrames.length - 1];
    if (!areFramesSimilar(frames[i].base64, lastUnique.base64)) {
      uniqueFrames.push(frames[i]);
    } else {
      skippedCount++;
    }
  }
  
  if (skippedCount > 0) {
    console.log(`Frame deduplication: skipped ${skippedCount} similar frames, keeping ${uniqueFrames.length}`);
  }
  
  return uniqueFrames;
}

/**
 * Validate video file before processing
 */
export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  const validTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
  
  if (!validTypes.includes(file.type) && !file.name.match(/\.(mp4|mov|webm|m4v)$/i)) {
    return { valid: false, error: 'Please upload a video file (MP4, MOV, or WebM).' };
  }

  // Max 100MB for videos
  if (file.size > 100 * 1024 * 1024) {
    return { valid: false, error: 'Video too large. Max 100MB.' };
  }

  return { valid: true };
}

/**
 * Check if file is a video
 */
export function isVideoFile(file: File): boolean {
  const videoTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
  return videoTypes.includes(file.type) || file.name.match(/\.(mp4|mov|webm|m4v)$/i) !== null;
}
