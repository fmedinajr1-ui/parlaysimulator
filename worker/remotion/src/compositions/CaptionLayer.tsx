// remotion/src/components/CaptionLayer.tsx
// Word-by-word highlighted captions. THIS IS THE COMPONENT THAT MATTERS MOST
// FOR RETENTION — TikTok data consistently shows videos with bold burned-in
// captions retain 30-45% better than videos without.
//
// Design:
//   - 3-4 words per "line" shown at once
//   - Currently-spoken word highlighted in bright yellow
//   - Positioned lower-third (not covering the face)
//   - Strong readability: white text, 4px black stroke, bold, wide font

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

interface WordTiming {
  word: string;
  start_sec: number;
  end_sec: number;
}

interface CaptionLayerProps {
  timings: WordTiming[];
  wordsPerGroup?: number;  // default 3
}

export const CaptionLayer: React.FC<CaptionLayerProps> = ({ timings, wordsPerGroup = 3 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  // Group timings into chunks of N words
  const groups: WordTiming[][] = [];
  for (let i = 0; i < timings.length; i += wordsPerGroup) {
    groups.push(timings.slice(i, i + wordsPerGroup));
  }

  // Find which group is active (current second falls inside its span)
  let activeGroup: WordTiming[] | null = null;
  for (const group of groups) {
    if (group.length === 0) continue;
    const groupStart = group[0].start_sec;
    const groupEnd = group[group.length - 1].end_sec;
    if (currentSec >= groupStart && currentSec <= groupEnd + 0.15) {
      activeGroup = group;
      break;
    }
  }
  if (!activeGroup) return null;

  return (
    <AbsoluteFill style={{
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingBottom: 420,
      pointerEvents: 'none',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 14,
        padding: '18px 32px',
        maxWidth: 960,
      }}>
        {activeGroup.map((w, i) => {
          const isActive = currentSec >= w.start_sec && currentSec <= w.end_sec + 0.05;
          return (
            <span
              key={`${w.start_sec}-${i}`}
              style={{
                fontFamily: '"Inter", "Helvetica Neue", sans-serif',
                fontSize: 78,
                fontWeight: 900,
                color: isActive ? '#FFE600' : '#FFFFFF',
                textShadow: '0 0 12px rgba(0,0,0,0.9), 4px 4px 0 #000, -4px 4px 0 #000, 4px -4px 0 #000, -4px -4px 0 #000',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                transform: isActive ? 'scale(1.08)' : 'scale(1)',
                transition: 'transform 70ms ease-out, color 40ms linear',
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
