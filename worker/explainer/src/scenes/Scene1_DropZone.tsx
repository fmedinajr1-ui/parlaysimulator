import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { PhoneMockup } from '../components/PhoneMockup';

/**
 * Scene 1 — "Drop your slip here"
 * Tightened contrast pass:
 *  - Solid dark drop-zone panel (#0d1620) instead of translucent
 *  - 2.5px dotted neon-cyan border
 *  - White 700-weight headline with text shadow
 *  - Soft inner glow ring pulsing on a 60-frame sine
 *  - Slip card animates in from above with shadow-2xl + ring-1 white/15
 */
export const Scene1DropZone: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Phone slides up + scales in
  const phoneSpring = spring({ frame, fps, config: { damping: 18, stiffness: 110, mass: 1 } });
  const phoneY = interpolate(phoneSpring, [0, 1], [80, 0]);
  const phoneScale = interpolate(phoneSpring, [0, 1], [0.92, 1]);

  // Pulsing inner glow on the drop zone
  const glowOpacity = 0.5 + 0.5 * Math.sin((frame / 60) * Math.PI * 2);

  // Slip card drops in around frame 30
  const cardSpring = spring({ frame: frame - 28, fps, config: { damping: 14, stiffness: 140 } });
  const cardY = interpolate(cardSpring, [0, 1], [-260, 0]);
  const cardOpacity = interpolate(cardSpring, [0, 0.5, 1], [0, 0.5, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      {/* Top label */}
      <div
        style={{
          position: 'absolute',
          top: 140,
          textAlign: 'center',
          opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translateY(${interpolate(frame, [0, 18], [-20, 0], { extrapolateRight: 'clamp' })}px)`,
        }}
      >
        <div
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '0.32em',
            color: '#5BFFC2',
            textTransform: 'uppercase',
          }}
        >
          DROP · SCAN · DECIDE
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 78,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            lineHeight: 1.0,
            textShadow: '0 4px 18px rgba(0,0,0,0.6)',
          }}
        >
          Drop your slip.
        </div>
      </div>

      {/* Phone */}
      <div style={{ transform: `translateY(${phoneY}px) scale(${phoneScale})` }}>
        <PhoneMockup width={560} height={1140}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              padding: 40,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {/* Drop zone — solid dark panel, thick dotted neon-cyan border */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '3 / 4',
                borderRadius: 36,
                background: '#0d1620',
                border: '2.5px dashed rgba(91, 255, 194, 0.7)',
                boxShadow: `inset 0 0 32px rgba(91, 255, 194, ${0.12 * glowOpacity}), 0 0 0 1px rgba(255,255,255,0.04)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {/* Slip card animates in over the drop zone */}
              <div
                style={{
                  width: '78%',
                  background: 'linear-gradient(180deg, #1a2332 0%, #0f1825 100%)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 22,
                  padding: '22px 24px',
                  boxShadow: '0 28px 60px rgba(0,0,0,0.7)',
                  transform: `translateY(${cardY}px)`,
                  opacity: cardOpacity,
                }}
              >
                <div
                  style={{
                    fontFamily: 'Space Grotesk',
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#5BFFC2',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                  }}
                >
                  5-LEG PARLAY
                </div>
                {[
                  { p: 'Jayson Tatum', l: 'Over 27.5 Pts', o: '−115' },
                  { p: 'Anthony Davis', l: 'Over 11.5 Reb', o: '−110' },
                  { p: 'Luka Dončić', l: 'Over 8.5 Ast', o: '−120' },
                  { p: 'Lakers', l: 'ML', o: '+150' },
                ].map((leg, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingTop: 14,
                      paddingBottom: 14,
                      borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)',
                      marginTop: i === 0 ? 12 : 0,
                    }}
                  >
                    <div>
                      <div style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>{leg.p}</div>
                      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14 }}>{leg.l}</div>
                    </div>
                    <div
                      style={{
                        fontFamily: 'Space Grotesk',
                        color: '#5BFFC2',
                        fontSize: 16,
                        fontWeight: 700,
                      }}
                    >
                      {leg.o}
                    </div>
                  </div>
                ))}
              </div>

              {/* "Drop here" label — only visible before the card lands */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 38,
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 22,
                  fontWeight: 700,
                  color: '#ffffff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                  opacity: interpolate(cardSpring, [0, 0.4], [1, 0], { extrapolateRight: 'clamp' }),
                  letterSpacing: '0.02em',
                }}
              >
                Drop your slip here
              </div>
            </div>
          </div>
        </PhoneMockup>
      </div>
    </AbsoluteFill>
  );
};