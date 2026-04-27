import React from 'react';

/**
 * Hand-crafted iPhone-ish frame.
 * Tightened contrast: pure-black bezel, inner highlight ring, white screen
 * border so the device pops cleanly off the dark gradient background.
 */
export const PhoneMockup: React.FC<{
  width?: number;
  height?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width = 540, height = 1100, children, style }) => {
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: 76,
        background: '#0a0a0a',
        // Outer drop shadow + inner 2px highlight ring for crisp edge against dark bg
        boxShadow:
          '0 0 0 2px rgba(255,255,255,0.08) inset, 0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.9)',
        padding: 14,
        ...style,
      }}
    >
      {/* Notch */}
      <div
        style={{
          position: 'absolute',
          top: 22,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 140,
          height: 32,
          borderRadius: 18,
          background: '#000',
          zIndex: 5,
        }}
      />
      {/* Screen */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: 64,
          background: '#03060c',
          overflow: 'hidden',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
        }}
      >
        {children}
      </div>
    </div>
  );
};