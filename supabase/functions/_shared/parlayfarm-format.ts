// Minimal stub kept solely for the frontend-facing `grade-slip` edge function.
// The legacy bot/telegram/parlay surface that used this module has been removed.
// Only `renderSlipVerdict` + its types are still referenced.

export type LegStatus = 'green' | 'yellow' | 'red';

export interface SlipLeg {
  status: LegStatus;
  text: string;
  note?: string;
}

export interface SlipVerdictInput {
  slipId: string;
  legCount: number;
  book: string;
  stake: string;
  payout: string;
  verdict: string;
  verdictTagline: string;
  score: number;
  legs: SlipLeg[];
  sharperPlayLines: string[];
}

const STATUS_ICON: Record<LegStatus, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
};

/**
 * Plain-text Telegram-friendly slip verdict block.
 * Intentionally simple — no MarkdownV2 escapes, just a clean readable card.
 */
export function renderSlipVerdict(input: SlipVerdictInput): string {
  const lines: string[] = [];
  lines.push(`🎟️ Slip Verdict — ${input.verdict} (${input.score.toFixed(0)}/100)`);
  lines.push(input.verdictTagline);
  lines.push('');
  lines.push(`Book: ${input.book}  •  Legs: ${input.legCount}  •  Stake: ${input.stake} → ${input.payout}`);
  lines.push('');
  for (const leg of input.legs) {
    lines.push(`${STATUS_ICON[leg.status]} ${leg.text}`);
    if (leg.note) lines.push(`   ↳ ${leg.note}`);
  }
  if (input.sharperPlayLines.length > 0) {
    lines.push('');
    lines.push('Sharper play:');
    for (const s of input.sharperPlayLines) lines.push(`• ${s}`);
  }
  lines.push('');
  lines.push(`ref: ${input.slipId.slice(0, 8)}`);
  return lines.join('\n');
}