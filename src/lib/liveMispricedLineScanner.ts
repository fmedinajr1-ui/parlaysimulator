import type { WarRoomPropData } from '@/components/scout/warroom/WarRoomPropCard';

export type LineValueClass = 'SOFT' | 'SHARP' | 'STALE';

export interface MispricingResult {
  score: number;
  classification: LineValueClass;
  l10Edge: number;
  projEdge: number;
  lineDrift: number;
  paceAdj: number; // the multiplier used
}

/**
 * Calculates line mispricing for each prop.
 * Runs client-side on every refresh — no API calls.
 */
export function calculateLineMispricing(
  props: WarRoomPropData[],
): Map<string, MispricingResult> {
  const results = new Map<string, MispricingResult>();

  for (const p of props) {
    const isOver = (p.side || 'OVER').toUpperCase() !== 'UNDER';
    const liveBookLine = p.liveBookLine ?? p.line;
    const originalLine = p.line;
    const l10Avg = p.l10Avg ?? liveBookLine; // fallback: assume line ≈ avg
    const paceMult = (p.paceRating ?? 100) / 100;
    const paceAdjL10 = l10Avg * paceMult;

    // L10 edge: pace-adjusted average vs live book line
    const l10Edge = isOver
      ? paceAdjL10 - liveBookLine
      : liveBookLine - paceAdjL10;

    // Projection edge: AI projection vs live book line
    const projEdge = isOver
      ? p.projectedFinal - liveBookLine
      : liveBookLine - p.projectedFinal;

    // Line drift: has the line moved for or against you?
    const lineDrift = isOver
      ? originalLine - liveBookLine   // line dropped = good for over
      : liveBookLine - originalLine;  // line went up = good for under

    // Composite score
    const score = (l10Edge * 0.4) + (projEdge * 0.35) + (lineDrift * 0.25);

    const classification: LineValueClass =
      score >= 1.5 ? 'SOFT' :
      score <= -1.5 ? 'STALE' :
      'SHARP';

    results.set(p.id, {
      score,
      classification,
      l10Edge,
      projEdge,
      lineDrift,
      paceAdj: paceMult,
    });
  }

  return results;
}
