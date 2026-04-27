import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { PhoneMockup } from '../components/PhoneMockup';

/**
 * Scene 5 — admin sees a single BROADCAST button on the phone.
 * Press → ripple of chat bubbles fans out to subscribers.
 */
export const Scene5BroadcastCTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const phoneS = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const phoneY = interpolate(phoneS, [0, 1], [40, 0]);

  // Button "press" pulse around frame 30
  const press = interpolate(frame, [30, 38, 48], [1, 0.94, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ripple = interpolate(frame, [38, 110], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 110,
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
            color: '#5BFFC2',
            textTransform: 'uppercase',
          }}
        >
          ONE-TAP BROADCAST
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
          Approve.<br />Send to all.
        </div>
      </div>

      <div style={{ position: 'relative', transform: `translateY(${phoneY}px)`, marginTop: 240 }}>
        <PhoneMockup width={520} height={1000}>
          <div style={{ width: '100%', height: '100%', padding: 36, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontFamily: 'Space Grotesk',
                fontSize: 18,
                fontWeight: 600,
                color: '#5BFFC2',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
              }}
            >
              ADMIN PREVIEW
            </div>
            <div
              style={{
                marginTop: 14,
                padding: '20px 22px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 18,
                color: 'rgba(255,255,255,0.85)',
                fontFamily: 'Inter',
                fontSize: 18,
                lineHeight: 1.4,
              }}
            >
              "3 of 5 legs sharp · 1 trap fade · sharper LeBron Over recommended."
            </div>

            {/* Big BROADCAST button */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                style={{
                  width: '92%',
                  padding: '32px 0',
                  borderRadius: 28,
                  background: 'linear-gradient(180deg, #5BFFC2 0%, #2DD4A8 100%)',
                  textAlign: 'center',
                  fontFamily: 'Space Grotesk',
                  fontWeight: 800,
                  fontSize: 38,
                  color: '#03060c',
                  letterSpacing: '0.18em',
                  transform: `scale(${press})`,
                  boxShadow: '0 18px 48px rgba(91,255,194,0.45), inset 0 -4px 0 rgba(0,0,0,0.15)',
                }}
              >
                BROADCAST
              </div>
            </div>
          </div>
        </PhoneMockup>

        {/* Ripple of chat bubbles flying out */}
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const delay = i * 0.06;
          const t = Math.max(0, ripple - delay);
          const opacity = interpolate(t, [0, 0.2, 1], [0, 1, 0]);
          const dist = interpolate(t, [0, 1], [0, 320]);
          const angle = -Math.PI / 2 + (i - 2.5) * 0.4;
          const x = Math.cos(angle) * dist;
          const y = Math.sin(angle) * dist;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: 50,
                transform: `translate(calc(-50% + ${x}px), ${y}px)`,
                opacity,
                padding: '14px 20px',
                background: '#1a2332',
                border: '1.5px solid rgba(91,255,194,0.6)',
                borderRadius: 999,
                color: '#5BFFC2',
                fontFamily: 'Space Grotesk',
                fontWeight: 700,
                fontSize: 22,
              }}
            >
              ✓ Sent
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};