export type ParlaySource = 'pvs' | 'sharp' | 'hitrate' | 'juiced' | 'suggestions' | 'manual' | 'godmode' | 'sweet-spots' | 'contrarian';

export interface UniversalLeg {
  id: string;
  description: string;
  odds: number;
  source: ParlaySource;
  sourceData?: Record<string, unknown>;
  playerName?: string;
  propType?: string;
  line?: number;
  side?: 'over' | 'under';
  sport?: string;
  eventId?: string;
  confidenceScore?: number;
  addedAt: string;
}

export interface ParlayBuilderState {
  legs: UniversalLeg[];
  isExpanded: boolean;
}

export const SOURCE_LABELS: Record<ParlaySource, { label: string; emoji: string; color: string }> = {
  pvs: { label: 'PVS', emoji: '🏆', color: 'text-chart-4' },
  sharp: { label: 'Sharp', emoji: '⚡', color: 'text-primary' },
  hitrate: { label: 'Hit Rate', emoji: '🎯', color: 'text-chart-2' },
  juiced: { label: 'Juiced', emoji: '🍊', color: 'text-chart-5' },
  suggestions: { label: 'AI Pick', emoji: '🤖', color: 'text-accent-foreground' },
  manual: { label: 'Manual', emoji: '✏️', color: 'text-muted-foreground' },
  godmode: { label: 'God Mode', emoji: '🔮', color: 'text-accent-foreground' },
  'sweet-spots': { label: 'Sweet Spot', emoji: '🎯', color: 'text-chart-2' },
  contrarian: { label: 'Contrarian', emoji: '🔄', color: 'text-chart-5' },
};
