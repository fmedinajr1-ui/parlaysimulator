import React from 'react';

type Verdict = 'KEEP' | 'SWAP' | 'DROP';

const COLORS: Record<Verdict, { bg: string; border: string; text: string }> = {
  KEEP: { bg: 'rgba(91,255,194,0.15)', border: 'rgba(91,255,194,0.7)', text: '#5BFFC2' },
  SWAP: { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.7)', text: '#FBBF24' },
  DROP: { bg: 'rgba(251,113,133,0.15)', border: 'rgba(251,113,133,0.7)', text: '#FB7185' },
};

export const VerdictPill: React.FC<{ verdict: Verdict; style?: React.CSSProperties }> = ({ verdict, style }) => {
  const c = COLORS[verdict];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '8px 16px',
        borderRadius: 999,
        background: c.bg,
        border: `1.5px solid ${c.border}`,
        color: c.text,
        fontFamily: 'Space Grotesk',
        fontWeight: 700,
        fontSize: 18,
        letterSpacing: '0.18em',
        ...style,
      }}
    >
      {verdict}
    </span>
  );
};