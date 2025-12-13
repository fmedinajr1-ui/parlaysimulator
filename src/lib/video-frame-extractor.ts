/**
 * Video frame extraction utility for betting slip recordings
 * Extracts frames from video files for AI analysis
 */

export interface ExtractedFrame {
  index: number;
  base64: string;
  timestamp: number;
}

export interface ExtractionProgress {
  stage: 'loading' | 'extracting' | 'complete';
  currentFrame: number;
  totalFrames: number;
  message: string;
}

export interface ExtractionResult {
  frames: ExtractedFrame[];
  duration: number;
  frameCount: number;
}

const MAX_FRAME_DIMENSION = 1280;
const FRAME_INTERVAL_SECONDS = 1; // Extract 1 frame per second
const MAX_FRAMES = 30; // Cap at 30 frames max
const JPEG_QUALITY = 0.85;

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

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const cleanup = () => {
      URL.revokeObjectURL(video.src);
      video.remove();
      canvas.remove();
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video file'));
    };

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      
      // Calculate frame extraction points
      const frameInterval = Math.max(
        FRAME_INTERVAL_SECONDS,
        duration / MAX_FRAMES
      );
      const totalFrames = Math.min(
        Math.floor(duration / frameInterval),
        MAX_FRAMES
      );

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
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      
      // Draw white background then frame
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);
      
      const base64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      resolve(base64);
    };

    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error(`Failed to seek to ${timestamp}s`));
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = timestamp;
  });
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
