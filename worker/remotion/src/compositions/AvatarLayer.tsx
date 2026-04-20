// remotion/src/components/AvatarLayer.tsx
// Displays the HeyGen avatar video. Two modes:
//   - fullscreen: avatar fills frame (used during dialogue beats)
//   - corner: avatar in bottom-right while b-roll or stat-card is main focus
//
// Supports smooth scale transitions between modes via interpolate.

import React from 'react';
import { AbsoluteFill, Video, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

interface AvatarLayerProps {
  videoUrl: string;
  mode: 'fullscreen' | 'corner' | 'hidden';
  transitionAtSec?: number;  // if mode should animate, what time to complete transition
}

export const AvatarLayer: React.FC<AvatarLayerProps> = ({ videoUrl, mode, transitionAtSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (mode === 'hidden' || !videoUrl) return null;

  // Fullscreen fills the canvas. Corner is 320x568 in bottom-right (9:16 mini)
  const targetStyle = mode === 'corner' ? {
    width: 320,
    height: 568,
    bottom: 40,
    right: 40,
    borderRadius: 24,
    overflow: 'hidden' as const,
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
  } : {
    width: '100%',
    height: '100%',
  };

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    ...targetStyle,
  };

  if (mode === 'corner' && transitionAtSec != null) {
    const transitionFrame = transitionAtSec * fps;
    const progress = interpolate(frame, [transitionFrame - 8, transitionFrame], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    containerStyle.transform = `scale(${1 - 0.4 * progress})`;
    containerStyle.opacity = 1 - 0.1 * progress;
  }

  return (
    <div style={containerStyle}>
      <Video
        src={videoUrl}
        muted  // audio comes from the master audio track, not the avatar video
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </div>
  );
};
