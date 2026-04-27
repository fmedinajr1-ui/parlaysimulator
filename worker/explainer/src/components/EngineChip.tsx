import React from 'react';

export const EngineChip: React.FC<{
  label: string;
  color: string;
  style?: React.CSSProperties;
}> = ({ label, color, style }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      padding: '14px 22px',
      borderRadius: 999,
      background: `linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))`,
      border: `1.5px solid ${color}80`,
      boxShadow: `0 0 24px ${color}40, inset 0 0 12px ${color}20`,
      ...style,
    }}
  >
    <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 12px ${color}` }} />
    <span
      style={{
        fontFamily: 'Space Grotesk',
        fontWeight: 700,
        fontSize: 22,
        letterSpacing: '0.04em',
        color: '#fff',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  </div>
);