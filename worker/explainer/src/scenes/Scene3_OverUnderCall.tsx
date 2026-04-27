import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { VerdictPill } from '../components/VerdictPill';

const LEGS: Array<{
  player: string;
  call: string;
  verdict: 'KEEP' | 'SWAP' | 'DROP';
}> = [
  { player: 'Tatum',   call: 'OVER 27.5 PTS', verdict: 'KEEP' },
  { player: 'Davis',   call: 'OVER 11.5 REB', verdict: 'KEEP' },
  { player: 'Luka',    call: 'UNDER 8.5 AST', verdict: 'SWAP' },
  { player: 'Lakers',  call: 'ML',            verdict: 'DROP' },
];

/**
 * Scene 3 — engine spits out a per-leg Over/Under verdict.
 */
export const Scene3OverUnderCall: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 130,
          textAlign: 'center',
          opacity: interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <div
          style={{
            fontFamily: 'Space Grotesk',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '0.32em',
            color: '#FBBF24',
            textTransform: 'uppercase',
          }}
        >
          PER-LEG VERDICT
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
          Over or Under.<br />Real consensus.
        </div>
      </div>

      {/* Leg rows */}
      <div
        style={{
          width: 880,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          marginTop: 240,
        }}
      >
        {LEGS.map((leg, i) => {
          const delay = 14 + i * 12;
          const s = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 130 } });
          const x = interpolate(s, [0, 1], [-80, 0]);
          const opacity = interpolate(s, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' });
          const pillS = spring({ frame: frame - (delay + 8), fps, config: { damping: 12 } });
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '24px 32px',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                border: '1.5px solid rgba(255,255,255,0.12)',
                borderRadius: 22,
                transform: `translateX(${x}px)`,
                opacity,
                boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
              }}
            >
              <div>
                <div style={{ fontFamily: 'Inter', fontSize: 20, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>
                  Leg {i + 1}
                </div>
                <div
                  style={{
                    fontFamily: 'Space Grotesk',
                    fontSize: 36,
                    fontWeight: 700,
                    color: '#fff',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {leg.player} <span style={{ color: '#5BFFC2', fontFamily: 'Space Grotesk' }}>· {leg.call}</span>
                </div>
              </div>
              <div style={{ transform: `scale(${interpolate(pillS, [0, 1], [0.4, 1])})`, opacity: pillS }}>
                <VerdictPill verdict={leg.verdict} />
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};