export type ParlaySource = 'pvs' | 'sharp' | 'hitrate' | 'juiced' | 'suggestions' | 'manual';

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
  pvs: { label: 'PVS', emoji: '🏆', color: 'text-yellow-500' },
  sharp: { label: 'Sharp', emoji: '⚡', color: 'text-blue-500' },
  hitrate: { label: 'Hit Rate', emoji: '🎯', color: 'text-green-500' },
  juiced: { label: 'Juiced', emoji: '🍊', color: 'text-orange-500' },
  suggestions: { label: 'AI Pick', emoji: '🤖', color: 'text-purple-500' },
  manual: { label: 'Manual', emoji: '✏️', color: 'text-muted-foreground' },
};
