import type { ScoutGameContext } from '@/pages/Scout';

export const demoGameContext: ScoutGameContext = {
  eventId: 'demo-lakers-celtics',
  homeTeam: 'Los Angeles Lakers',
  awayTeam: 'Boston Celtics',
  commenceTime: new Date().toISOString(),
  gameDescription: 'Boston Celtics @ Los Angeles Lakers',
  homeRoster: [],
  awayRoster: [],
};

export const demoConfidencePicks = [
  { playerName: 'LeBron James', propType: 'points', line: 24.5, currentValue: 18, side: 'over' as const },
  { playerName: 'Jayson Tatum', propType: 'rebounds', line: 8.5, currentValue: 5, side: 'over' as const },
  { playerName: 'Anthony Davis', propType: 'blocks', line: 2.5, currentValue: 1, side: 'over' as const },
  { playerName: 'Jrue Holiday', propType: 'assists', line: 5.5, currentValue: 7, side: 'over' as const },
  { playerName: 'Austin Reaves', propType: 'points', line: 16.5, currentValue: 19, side: 'under' as const },
];

export const demoWhisperPicks = demoConfidencePicks.map((p) => ({
  ...p,
  gameProgress: 0.5,
}));

export const demoWhaleSignals = new Map<string, { signalType: 'STEAM' | 'FREEZE' | 'DIVERGENCE'; sharpScore: number }>([
  ['LeBron James_points', { signalType: 'STEAM', sharpScore: 8.5 }],
  ['Jayson Tatum_rebounds', { signalType: 'DIVERGENCE', sharpScore: 7.2 }],
]);
