import React from 'react';
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

interface WordTiming { word: string; start_sec: number; end_sec: number; }

/**
 * Karaoke-style 3-word group captions. Sits in the lower third.
 */
export const CaptionLayer: React.FC<{ timings: WordTiming[] }> = ({ timings }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  // Group words into rolling triplets centered on the current word.
  const activeIdx = timings.findIndex((w) => sec >= w.start_sec && sec <= w.end_sec + 0.05);
  if (activeIdx < 0) return null;

  const start = Math.max(0, activeIdx - 1);
  const end = Math.min(timings.length, activeIdx + 2);
  const group = timings.slice(start, end);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 220,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 18,
          padding: '18px 32px',
          background: 'rgba(3, 6, 12, 0.72)',
          backdropFilter: 'none',
          border: '1.5px solid rgba(255,255,255,0.08)',
          borderRadius: 18,
          maxWidth: 920,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        {group.map((w, i) => {
          const isActive = start + i === activeIdx;
          return (
            <span
              key={i}
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                fontWeight: 700,
                fontSize: 44,
                letterSpacing: '-0.01em',
                color: isActive ? '#5BFFC2' : 'rgba(255,255,255,0.55)',
                textShadow: isActive ? '0 0 18px rgba(91,255,194,0.5)' : 'none',
                transition: 'none',
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};