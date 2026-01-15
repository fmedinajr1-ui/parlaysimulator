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
 * Check if camera access is supported (for capture cards)
 */
export function isCameraSupported(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Known capture card device name patterns
 */
const CAPTURE_CARD_PATTERNS = [
  'elgato',
  'avermedia',
  'magewell',
  'blackmagic',
  'razer ripsaw',
  'corsair',
  'decklink',
  'hdmi',
  'game capture',
  'usb video',
  'video capture',
  'cam link',
  'hd60',
  'hd 60',
  '4k60',
  '4k capture',
  'capture device',
  'genki',
  'pengo',
  'startech',
];

export interface ClassifiedVideoDevice {
  device: MediaDeviceInfo;
  type: 'capture_card' | 'webcam' | 'unknown';
  priority: number;
  displayName: string;
}

/**
 * Classify a video device as capture card, webcam, or unknown
 */
function classifyVideoDevice(device: MediaDeviceInfo): ClassifiedVideoDevice {
  const label = device.label.toLowerCase();
  
  // Check for capture card patterns
  const isCaptureCard = CAPTURE_CARD_PATTERNS.some(pattern => 
    label.includes(pattern)
  );
  
  // Check for webcam patterns
  const isWebcam = label.includes('facetime') || 
                   label.includes('webcam') || 
                   label.includes('integrated') ||
                   label.includes('built-in') ||
                   label.includes('front camera') ||
                   label.includes('rear camera') ||
                   label.includes('iphone') ||
                   label.includes('ipad');
  
  const type = isCaptureCard ? 'capture_card' : isWebcam ? 'webcam' : 'unknown';
  
  return {
    device,
    type,
    priority: isCaptureCard ? 1 : type === 'unknown' ? 2 : 3,
    displayName: formatDeviceName(device.label, type),
  };
}

/**
 * Format device name for display
 */
function formatDeviceName(label: string, type: 'capture_card' | 'webcam' | 'unknown'): string {
  if (!label) {
    return type === 'capture_card' ? 'Capture Card' : type === 'webcam' ? 'Camera' : 'Video Device';
  }
  
  // Clean up the label
  let name = label
    .replace(/\s*\([^)]*\)\s*/g, ' ') // Remove parenthetical text
    .replace(/\s+/g, ' ')
    .trim();
  
  // Add type indicator if not obvious from the name
  if (type === 'capture_card') {
    const hasIndicator = CAPTURE_CARD_PATTERNS.some(p => 
      label.toLowerCase().includes(p) && 
      (p.includes('capture') || p.includes('hdmi') || p.includes('cam link'))
    );
    if (!hasIndicator) {
      name = `${name} (Capture)`;
    }
  }
  
  return name || label;
}

/**
 * Get list of available video input devices (cameras, capture cards)
 * Returns devices sorted with capture cards first
 */
export async function getVideoDevices(): Promise<ClassifiedVideoDevice[]> {
  try {
    // Request permission first to get device labels
    await navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      stream.getTracks().forEach(track => track.stop());
    }).catch(() => {});
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    // Classify and sort devices (capture cards first)
    return videoDevices
      .map(device => classifyVideoDevice(device))
      .sort((a, b) => a.priority - b.priority);
  } catch (error) {
    console.error('Failed to enumerate video devices:', error);
    return [];
  }
}

/**
 * Get raw list of video devices (backwards compatibility)
 */
export async function getVideoDevicesRaw(): Promise<MediaDeviceInfo[]> {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      stream.getTracks().forEach(track => track.stop());
    }).catch(() => {});
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
  } catch (error) {
    console.error('Failed to enumerate video devices:', error);
    return [];
  }
}

/**
 * Request camera/capture card access by device ID
 */
export async function requestCameraCapture(deviceId?: string): Promise<MediaStream> {
  try {
    const constraints: MediaStreamConstraints = {
      video: deviceId 
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    };
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Camera permission denied');
      }
      if (error.name === 'NotFoundError') {
        throw new Error('No camera or capture card found');
      }
    }
    throw new Error('Failed to access camera/capture card');
  }
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
