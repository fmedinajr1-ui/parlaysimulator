import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { EngineChip } from '../components/EngineChip';

const ENGINES = [
  { label: 'Unified PVS', color: '#5BFFC2' },
  { label: 'Median Lock', color: '#7DD3FC' },
  { label: 'Juiced Props', color: '#FBBF24' },
  { label: 'L10 Hit Rates', color: '#A78BFA' },
  { label: 'Sharp Money', color: '#22D3EE' },
  { label: 'Trap Probability', color: '#FB7185' },
  { label: 'Injury Reports', color: '#F472B6' },
  { label: 'Fatigue', color: '#FACC15' },
];

/**
 * Scene 2 — 8 engine chips orbit a central "LEG" hub, then fly in to converge.
 */
export const Scene2EngineFanout: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const cx = width / 2;
  const cy = height / 2 - 50;

  return (
    <AbsoluteFill>
      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 130,
          left: 0,
          right: 0,
          textAlign: 'center',
          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <div
          style={{
            fontFamily: 'Space Grotesk',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '0.32em',
            color: '#5BFFC2',
            textTransform: 'uppercase',
          }}
        >
          8 ENGINES · CROSS-REFERENCE
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: 'Space Grotesk',
            fontSize: 76,
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1.0,
            letterSpacing: '-0.02em',
            textShadow: '0 4px 20px rgba(0,0,0,0.7)',
          }}
        >
          Every leg.<br />Eight engines.
        </div>
      </div>

      {/* Central hub */}
      <div
        style={{
          position: 'absolute',
          left: cx - 110,
          top: cy - 110,
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(91,255,194,0.25) 0%, rgba(91,255,194,0.05) 70%, transparent 100%)',
          border: '2px solid rgba(91,255,194,0.6)',
          boxShadow: '0 0 60px rgba(91,255,194,0.4), inset 0 0 40px rgba(91,255,194,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Space Grotesk',
          fontSize: 28,
          fontWeight: 700,
          color: '#fff',
          letterSpacing: '0.08em',
        }}
      >
        LEG
      </div>

      {/* Engine chips fly in from a circular arrangement */}
      {ENGINES.map((eng, i) => {
        const angle = (i / ENGINES.length) * Math.PI * 2 - Math.PI / 2;
        // Smaller horizontal radius to keep wide chips inside the 1080 frame
        const finalRadiusX = 360;
        const finalRadiusY = 460;
        const startRadius = 900;
        const delay = 8 + i * 4;
        const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 80 } });
        const t = interpolate(s, [0, 1], [0, 1]);
        const startX = cx + Math.cos(angle) * startRadius;
        const startY = cy + Math.sin(angle) * startRadius;
        const endX = cx + Math.cos(angle) * finalRadiusX;
        const endY = cy + Math.sin(angle) * finalRadiusY;
        const x = interpolate(t, [0, 1], [startX, endX]);
        const y = interpolate(t, [0, 1], [startY, endY]);
        const opacity = interpolate(s, [0, 0.4], [0, 1], { extrapolateRight: 'clamp' });

        // Lines from chip to hub
        const lineOpacity = interpolate(s, [0.6, 1], [0, 0.35], { extrapolateRight: 'clamp' });
        return (
          <React.Fragment key={i}>
            {/* SVG line */}
            <svg
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            >
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke={eng.color}
                strokeWidth={1.5}
                strokeDasharray="6 6"
                opacity={lineOpacity}
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                left: x,
                top: y,
                transform: 'translate(-50%, -50%)',
                opacity,
              }}
            >
              <EngineChip label={eng.label} color={eng.color} />
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};