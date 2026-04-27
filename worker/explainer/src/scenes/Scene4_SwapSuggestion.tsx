import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

/**
 * Scene 4 — weak leg gets struck through, sharper alt slides in with +EV chip.
 */
export const Scene4SwapSuggestion: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardS = spring({ frame, fps, config: { damping: 18, stiffness: 110 } });
  const cardY = interpolate(cardS, [0, 1], [40, 0]);

  // Strikethrough sweeps across the weak leg
  const strikePct = interpolate(frame, [22, 50], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Sharper leg appears
  const altS = spring({ frame: frame - 56, fps, config: { damping: 14, stiffness: 130 } });
  const altY = interpolate(altS, [0, 1], [40, 0]);

  // EV chip pop
  const evS = spring({ frame: frame - 80, fps, config: { damping: 10, stiffness: 160 } });

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
            color: '#A78BFA',
            textTransform: 'uppercase',
          }}
        >
          SHARPER ALTERNATIVE
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
          Swap. Don't guess.
        </div>
      </div>

      <div
        style={{
          width: 880,
          marginTop: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        {/* Weak leg */}
        <div
          style={{
            position: 'relative',
            padding: '28px 32px',
            background: 'rgba(251,113,133,0.08)',
            border: '1.5px solid rgba(251,113,133,0.45)',
            borderRadius: 22,
            transform: `translateY(${cardY}px)`,
            opacity: cardS,
          }}
        >
          <div style={{ fontFamily: 'Inter', fontSize: 18, color: '#FB7185', fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Weak leg
          </div>
          <div
            style={{
              position: 'relative',
              fontFamily: 'Space Grotesk',
              fontSize: 38,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.85)',
              marginTop: 6,
              display: 'inline-block',
            }}
          >
            Luka · UNDER 8.5 AST
            {/* Strikethrough overlay */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: '52%',
                height: 4,
                background: '#FB7185',
                width: `${strikePct}%`,
                boxShadow: '0 0 12px rgba(251,113,133,0.6)',
              }}
            />
          </div>
        </div>

        {/* Arrow */}
        <div
          style={{
            textAlign: 'center',
            fontSize: 56,
            color: '#5BFFC2',
            opacity: interpolate(frame, [50, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        >
          ↓
        </div>

        {/* Sharper alt */}
        <div
          style={{
            position: 'relative',
            padding: '28px 32px',
            background: 'linear-gradient(180deg, rgba(91,255,194,0.16), rgba(91,255,194,0.04))',
            border: '2px solid rgba(91,255,194,0.7)',
            borderRadius: 22,
            transform: `translateY(${altY}px)`,
            opacity: altS,
            boxShadow: '0 18px 48px rgba(91,255,194,0.18), inset 0 0 24px rgba(91,255,194,0.08)',
          }}
        >
          <div style={{ fontFamily: 'Inter', fontSize: 18, color: '#5BFFC2', fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Sharper pick
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 6,
            }}
          >
            <div
              style={{
                fontFamily: 'Space Grotesk',
                fontSize: 38,
                fontWeight: 700,
                color: '#fff',
              }}
            >
              LeBron · OVER 6.5 AST
            </div>
            <div
              style={{
                transform: `scale(${interpolate(evS, [0, 1], [0.4, 1])})`,
                opacity: evS,
                padding: '12px 22px',
                borderRadius: 999,
                background: '#5BFFC2',
                color: '#03060c',
                fontFamily: 'Space Grotesk',
                fontWeight: 800,
                fontSize: 26,
                letterSpacing: '0.04em',
                boxShadow: '0 0 28px rgba(91,255,194,0.6)',
              }}
            >
              +11% EV
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};