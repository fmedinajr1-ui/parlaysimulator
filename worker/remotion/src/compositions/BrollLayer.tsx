// remotion/src/components/BrollLayer.tsx
// Plays b-roll footage during beats with visual='broll'. Covers the frame
// while the avatar shrinks to the corner.

import React from 'react';
import { AbsoluteFill, OffthreadVideo } from 'remotion';

interface BrollLayerProps {
  videoUrl: string;
}

export const BrollLayer: React.FC<BrollLayerProps> = ({ videoUrl }) => {
  if (!videoUrl) {
    // Fallback: dark background with subtle gradient so it's not jarring if
    // pexels returned nothing
    return (
      <AbsoluteFill style={{
        background: 'linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 100%)',
      }} />
    );
  }
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={videoUrl}
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
      {/* subtle dark vignette for caption legibility */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)',
      }} />
    </AbsoluteFill>
  );
};
