// Historical accuracy data based on 131 verified fatigue edges
export const HISTORICAL_ACCURACY = {
  '30+': { winRate: 51.4, roi: -1.9, rating: 'avoid', label: 'High Risk', color: 'amber' },
  '20-29': { winRate: 55.3, roi: 5.6, rating: 'best', label: 'Best Bet', color: 'green' },
  '15-19': { winRate: 52.6, roi: 0.5, rating: 'marginal', label: 'Marginal', color: 'slate' },
} as const;

export type DifferentialBucket = keyof typeof HISTORICAL_ACCURACY;

export function getDifferentialBucket(differential: number): DifferentialBucket | null {
  if (differential >= 30) return '30+';
  if (differential >= 20) return '20-29';
  if (differential >= 15) return '15-19';
  return null;
}

export function getPredictionData(differential: number) {
  const bucket = getDifferentialBucket(differential);
  if (!bucket) return null;
  
  return {
    bucket,
    ...HISTORICAL_ACCURACY[bucket],
  };
}

export function isSweetSpot(differential: number): boolean {
  return differential >= 20 && differential < 30;
}

export function isHighRisk(differential: number): boolean {
  return differential >= 30;
}

export function getConfidenceColor(differential: number): string {
  if (isSweetSpot(differential)) return 'text-neon-green';
  if (isHighRisk(differential)) return 'text-amber-400';
  return 'text-muted-foreground';
}

export function getConfidenceBgColor(differential: number): string {
  if (isSweetSpot(differential)) return 'bg-neon-green/20 border-neon-green/30';
  if (isHighRisk(differential)) return 'bg-amber-500/20 border-amber-500/30';
  return 'bg-muted/50 border-border/50';
}
