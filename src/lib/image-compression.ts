/**
 * Image compression utility for betting slip uploads
 * Reduces file size before sending to OpenAI vision API
 */

const MAX_DIMENSION = 1920; // Max width or height
const COMPRESSION_QUALITY = 0.8; // JPEG quality (0-1)

export interface CompressionResult {
  base64: string;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}

/**
 * Compress an image file before upload
 * - Resizes if larger than MAX_DIMENSION
 * - Converts to JPEG for better compression
 * - Returns base64 string ready for API
 */
export async function compressImage(file: File): Promise<CompressionResult> {
  const originalSize = file.size;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    img.onload = () => {
      let { width, height } = img;
      let wasResized = false;

      // Calculate new dimensions if needed
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        wasResized = true;
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      // Set canvas dimensions
      canvas.width = width;
      canvas.height = height;

      // Draw image with white background (for transparency handling)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to JPEG base64
      const base64 = canvas.toDataURL('image/jpeg', COMPRESSION_QUALITY);
      
      // Calculate compressed size (rough estimate from base64)
      const compressedSize = Math.round((base64.length * 3) / 4);

      console.log(`Image compression: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (${wasResized ? 'resized' : 'quality only'})`);

      resolve({
        base64,
        originalSize,
        compressedSize,
        wasCompressed: wasResized || compressedSize < originalSize
      });
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    // Load the image from file
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Validate image file before processing
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: 'Please upload an image file.' };
  }

  // Max 20MB before compression
  if (file.size > 20 * 1024 * 1024) {
    return { valid: false, error: 'File too large. Max 20MB.' };
  }

  return { valid: true };
}

/**
 * Validate any media file (image or video) before processing
 */
export function validateMediaFile(file: File): { valid: boolean; error?: string; isVideo: boolean } {
  // Check for video
  const videoTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
  const isVideo = videoTypes.includes(file.type) || file.name.match(/\.(mp4|mov|webm|m4v)$/i) !== null;
  
  if (isVideo) {
    // Max 100MB for videos
    if (file.size > 100 * 1024 * 1024) {
      return { valid: false, error: 'Video too large. Max 100MB.', isVideo: true };
    }
    return { valid: true, isVideo: true };
  }
  
  // Check for image
  if (file.type.startsWith('image/')) {
    if (file.size > 20 * 1024 * 1024) {
      return { valid: false, error: 'Image too large. Max 20MB.', isVideo: false };
    }
    return { valid: true, isVideo: false };
  }
  
  return { valid: false, error: 'Please upload an image or video file.', isVideo: false };
}
