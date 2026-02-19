import { describe, it, expect } from 'vitest';
import {
  validateVideoFile,
  areFramesSimilar,
  deduplicateFrames,
  detectDuplicateFrameIssue,
  isVideoFile,
  type ExtractedFrame,
} from '@/lib/video-frame-extractor';

// Helper to create a mock File
function mockFile(name: string, size: number, type: string): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

// Helper to create a fake frame
function fakeFrame(index: number, base64: string): ExtractedFrame {
  return { index, base64, timestamp: index * 2 };
}

describe('validateVideoFile', () => {
  it('accepts MP4 files', () => {
    const file = mockFile('test.mp4', 5_000_000, 'video/mp4');
    expect(validateVideoFile(file)).toEqual({ valid: true });
  });

  it('accepts MOV files', () => {
    const file = mockFile('test.mov', 5_000_000, 'video/quicktime');
    expect(validateVideoFile(file)).toEqual({ valid: true });
  });

  it('accepts WebM files', () => {
    const file = mockFile('test.webm', 5_000_000, 'video/webm');
    expect(validateVideoFile(file)).toEqual({ valid: true });
  });

  it('rejects non-video files', () => {
    const file = mockFile('test.pdf', 5_000_000, 'application/pdf');
    const result = validateVideoFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('video file');
  });

  it('rejects files over 100MB', () => {
    const file = mockFile('test.mp4', 101 * 1024 * 1024, 'video/mp4');
    const result = validateVideoFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('100MB');
  });

  it('accepts files by extension when MIME type is generic', () => {
    const file = mockFile('recording.mp4', 5_000_000, 'application/octet-stream');
    expect(validateVideoFile(file).valid).toBe(true);
  });
});

describe('isVideoFile', () => {
  it('returns true for video MIME types', () => {
    expect(isVideoFile(mockFile('a.mp4', 100, 'video/mp4'))).toBe(true);
    expect(isVideoFile(mockFile('a.webm', 100, 'video/webm'))).toBe(true);
  });

  it('returns true for video extensions with generic MIME', () => {
    expect(isVideoFile(mockFile('a.mov', 100, 'application/octet-stream'))).toBe(true);
  });

  it('returns false for non-video files', () => {
    expect(isVideoFile(mockFile('a.png', 100, 'image/png'))).toBe(false);
  });
});

describe('areFramesSimilar', () => {
  it('returns false for very different length strings', () => {
    const short = 'a'.repeat(1000);
    const long = 'b'.repeat(5000);
    expect(areFramesSimilar(short, long)).toBe(false);
  });

  it('returns true for identical strings', () => {
    const frame = 'x'.repeat(5000);
    expect(areFramesSimilar(frame, frame)).toBe(true);
  });

  it('returns true when length ratio exceeds threshold', () => {
    const a = 'a'.repeat(10000);
    const b = 'a'.repeat(9500); // ratio = 0.95 > 0.92
    expect(areFramesSimilar(a, b)).toBe(true);
  });

  it('returns false when below threshold', () => {
    const a = 'a'.repeat(10000);
    const b = 'b'.repeat(8700); // ratio = 0.87, between 0.85 and 0.92
    expect(areFramesSimilar(a, b)).toBe(false);
  });
});

describe('deduplicateFrames', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateFrames([])).toEqual([]);
  });

  it('returns single frame unchanged', () => {
    const frames = [fakeFrame(0, 'abc')];
    expect(deduplicateFrames(frames)).toHaveLength(1);
  });

  it('removes consecutive duplicates', () => {
    const same = 'x'.repeat(10000);
    const frames = [
      fakeFrame(0, same),
      fakeFrame(1, same),
      fakeFrame(2, same),
    ];
    const result = deduplicateFrames(frames);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(0);
  });

  it('keeps unique frames', () => {
    const frames = [
      fakeFrame(0, 'a'.repeat(5000)),
      fakeFrame(1, 'b'.repeat(2000)), // very different length
      fakeFrame(2, 'c'.repeat(8000)),
    ];
    expect(deduplicateFrames(frames)).toHaveLength(3);
  });
});

describe('detectDuplicateFrameIssue', () => {
  it('returns no issue for few frames', () => {
    const frames = [fakeFrame(0, 'a'), fakeFrame(1, 'b')];
    const result = detectDuplicateFrameIssue(frames);
    expect(result.hasDuplicateIssue).toBe(false);
  });

  it('detects when most frames are identical to first', () => {
    const same = 'x'.repeat(10000);
    const frames = Array.from({ length: 10 }, (_, i) => fakeFrame(i, same));
    const result = detectDuplicateFrameIssue(frames);
    expect(result.hasDuplicateIssue).toBe(true);
    expect(result.message).toBeTruthy();
  });

  it('returns no issue for diverse frames', () => {
    const frames = Array.from({ length: 10 }, (_, i) =>
      fakeFrame(i, String(i).repeat(3000 + i * 500))
    );
    const result = detectDuplicateFrameIssue(frames);
    expect(result.hasDuplicateIssue).toBe(false);
  });
});
