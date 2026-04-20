// remotion/src/components/LowerThird.tsx
// Two components in one file:
//   - LowerThird: a sticker-style on-screen text callout
//   - StatCard: full-frame data display used on stat_card beats

import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

// ─── LowerThird ──────────────────────────────────────────────────────────

export const LowerThird: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entry = spring({ frame, fps, config: { damping: 12, stiffness: 120 } });

  return (
    <AbsoluteFill style={{
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: 200,
      pointerEvents: 'none',
    }}>
      <div style={{
        backgroundColor: '#FFE600',
        color: '#000',
        padding: '22px 48px',
        borderRadius: 14,
        fontFamily: '"Inter", "Helvetica Neue", sans-serif',
        fontSize: 58,
        fontWeight: 900,
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        transform: `translateY(${-80 * (1 - entry)}px) rotate(${-2 * (1 - entry)}deg)`,
        opacity: entry,
        boxShadow: '6px 6px 0 #000',
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

// ─── StatCard ────────────────────────────────────────────────────────────

interface StatCardProps {
  data: {
    title: string;
    rows: Array<{ label: string; value: string; highlight?: boolean }>;
    footer?: string;
  };
}

export const StatCard: React.FC<StatCardProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entry = spring({ frame, fps, config: { damping: 15 } });

  return (
    <AbsoluteFill style={{
      background: 'linear-gradient(180deg, #111 0%, #000 100%)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 60,
    }}>
      <div style={{
        width: '90%',
        backgroundColor: '#161616',
        borderRadius: 24,
        padding: '56px 48px',
        border: '2px solid #2a2a2a',
        transform: `translateY(${40 * (1 - entry)}px)`,
        opacity: entry,
      }}>
        {/* Title */}
        <div style={{
          color: '#FFE600',
          fontSize: 52,
          fontFamily: '"Inter", sans-serif',
          fontWeight: 800,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          marginBottom: 44,
          textAlign: 'center',
        }}>
          {data.title}
        </div>

        {/* Rows */}
        {data.rows.map((row, i) => {
          const rowEntry = spring({
            frame: Math.max(0, frame - i * 4),
            fps, config: { damping: 14 },
          });
          return (
            <div key={i} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '24px 16px',
              borderBottom: i < data.rows.length - 1 ? '1px solid #2a2a2a' : 'none',
              transform: `translateX(${-30 * (1 - rowEntry)}px)`,
              opacity: rowEntry,
            }}>
              <span style={{
                color: '#8a8a8a',
                fontSize: 44,
                fontFamily: '"Inter", sans-serif',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
              }}>
                {row.label}
              </span>
              <span style={{
                color: row.highlight ? '#FFE600' : '#ffffff',
                fontSize: 60,
                fontFamily: '"Inter", sans-serif',
                fontWeight: 900,
                letterSpacing: '-0.5px',
              }}>
                {row.value}
              </span>
            </div>
          );
        })}

        {/* Footer */}
        {data.footer && (
          <div style={{
            marginTop: 40,
            textAlign: 'center',
            color: '#bababa',
            fontSize: 36,
            fontFamily: '"Inter", sans-serif',
            fontStyle: 'italic',
            opacity: entry,
          }}>
            {data.footer}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
