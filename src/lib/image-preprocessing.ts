/**
 * Image preprocessing utilities for OCR optimization
 * Enhances betting slip images before sending to vision API
 */

export interface PreprocessingOptions {
  contrast?: number;      // 1.0 = no change, 1.2-1.5 = typical OCR boost
  sharpen?: boolean;      // Apply unsharp mask
  autoLevel?: boolean;    // Stretch histogram for better dynamic range
}

const DEFAULT_OPTIONS: PreprocessingOptions = {
  contrast: 1.3,
  sharpen: true,
  autoLevel: true,
};

/**
 * Clamp a value between 0 and 255
 */
function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Adjust contrast using linear formula
 * factor > 1 increases contrast, < 1 decreases
 */
function adjustContrast(imageData: ImageData, factor: number): void {
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(factor * (data[i] - 128) + 128);         // R
    data[i + 1] = clamp(factor * (data[i + 1] - 128) + 128); // G
    data[i + 2] = clamp(factor * (data[i + 2] - 128) + 128); // B
    // Alpha unchanged
  }
}

/**
 * Auto-level: stretch histogram to use full 0-255 range
 * Helps with washed-out or dark images
 */
function autoLevel(imageData: ImageData): void {
  const data = imageData.data;
  let minLum = 255;
  let maxLum = 0;
  
  // Find min/max luminance
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }
  
  // Avoid division by zero
  const range = maxLum - minLum;
  if (range < 10) return; // Image already has good contrast or is nearly uniform
  
  const scale = 255 / range;
  
  // Apply stretching
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp((data[i] - minLum) * scale);
    data[i + 1] = clamp((data[i + 1] - minLum) * scale);
    data[i + 2] = clamp((data[i + 2] - minLum) * scale);
  }
}

/**
 * Apply 3x3 sharpening convolution kernel (unsharp mask)
 * Kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0]
 */
function sharpenImage(imageData: ImageData, width: number, height: number): ImageData {
  const src = imageData.data;
  const output = new Uint8ClampedArray(src.length);
  
  // Copy original data first
  output.set(src);
  
  // Sharpening kernel weights
  const kernel = [
    0, -1, 0,
    -1, 5, -1,
    0, -1, 0
  ];
  
  // Apply convolution (skip edges)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      
      for (let c = 0; c < 3; c++) { // RGB channels only
        let sum = 0;
        let ki = 0;
        
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const srcIdx = ((y + ky) * width + (x + kx)) * 4 + c;
            sum += src[srcIdx] * kernel[ki];
            ki++;
          }
        }
        
        output[idx + c] = clamp(sum);
      }
      // Keep alpha
      output[idx + 3] = src[idx + 3];
    }
  }
  
  return new ImageData(output, width, height);
}

/**
 * Main preprocessing function for OCR optimization
 * Returns processed base64 string
 */
export async function preprocessForOCR(
  img: HTMLImageElement,
  options: PreprocessingOptions = DEFAULT_OPTIONS
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }
  
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  
  // Draw original image
  ctx.drawImage(img, 0, 0);
  
  // Get image data for processing
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  // Step 1: Auto-level (histogram stretching)
  if (opts.autoLevel) {
    autoLevel(imageData);
  }
  
  // Step 2: Contrast enhancement
  if (opts.contrast && opts.contrast !== 1.0) {
    adjustContrast(imageData, opts.contrast);
  }
  
  // Step 3: Sharpening (creates new ImageData)
  if (opts.sharpen) {
    imageData = sharpenImage(imageData, canvas.width, canvas.height);
  }
  
  // Put processed data back
  ctx.putImageData(imageData, 0, 0);
  
  // Return as JPEG base64
  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Apply OCR enhancements directly to ImageData
 * Used for video frame preprocessing
 */
export function applyOCREnhancements(
  imageData: ImageData,
  width: number,
  height: number,
  options: PreprocessingOptions = DEFAULT_OPTIONS
): ImageData {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Step 1: Auto-level
  if (opts.autoLevel) {
    autoLevel(imageData);
  }
  
  // Step 2: Contrast
  if (opts.contrast && opts.contrast !== 1.0) {
    adjustContrast(imageData, opts.contrast);
  }
  
  // Step 3: Sharpen
  if (opts.sharpen) {
    return sharpenImage(imageData, width, height);
  }
  
  return imageData;
}
