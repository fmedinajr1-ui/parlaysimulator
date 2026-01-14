/**
 * Live Stream Capture Utilities
 * Handles screen capture, frame extraction, and burst capture for key moments
 */

export interface CapturedFrame {
  id: string;
  data: string; // base64
  timestamp: Date;
  isPriority: boolean;
}

/**
 * Request screen/tab capture from user
 */
export async function requestScreenCapture(): Promise<MediaStream> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    return stream;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Screen capture permission denied');
      }
      if (error.name === 'NotFoundError') {
        throw new Error('No screen available for capture');
      }
    }
    throw new Error('Failed to start screen capture');
  }
}

/**
 * Stop screen capture and cleanup
 */
export function stopScreenCapture(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}

/**
 * Capture single frame from video element
 */
export function captureFrame(video: HTMLVideoElement, quality: number = 0.8): string {
  const canvas = document.createElement('canvas');
  // Scale down for faster processing
  const targetWidth = 1280;
  const targetHeight = 720;
  
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  
  ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Capture burst of frames for key moments
 * Captures multiple frames in rapid succession
 */
export async function captureFrameBurst(
  video: HTMLVideoElement,
  count: number = 5,
  intervalMs: number = 200,
  quality: number = 0.8
): Promise<string[]> {
  const frames: string[] = [];
  
  for (let i = 0; i < count; i++) {
    frames.push(captureFrame(video, quality));
    if (i < count - 1) {
      await sleep(intervalMs);
    }
  }
  
  return frames;
}

/**
 * Calculate optimal capture interval based on game situation
 */
export function getAdaptiveCaptureInterval(
  quarter: string,
  hasRecentKeyMoment: boolean
): number {
  // More frequent captures in Q2 (approaching halftime)
  if (quarter === 'Q2') {
    return hasRecentKeyMoment ? 15000 : 20000; // 15-20 seconds
  }
  // Standard interval for Q1
  return hasRecentKeyMoment ? 20000 : 30000; // 20-30 seconds
}

/**
 * Play haptic feedback for mobile devices
 */
export function playHapticFeedback(duration: number = 100): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(duration);
  }
}

/**
 * Check if screen capture is supported
 */
export function isScreenCaptureSupported(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

/**
 * Get moment type label for display
 */
export function getMomentLabel(type: string): string {
  const labels: Record<string, string> = {
    timeout: 'Timeout / Huddle',
    injury: 'Injury Check',
    fastbreak: 'Fast Break',
    freethrow: 'Free Throw',
    other: 'Key Moment',
  };
  return labels[type] || 'Key Moment';
}

/**
 * Format time for display
 */
export function formatCaptureTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
