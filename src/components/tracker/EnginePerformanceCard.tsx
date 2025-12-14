import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface EnginePerformance {
  total: number;
  won: number;
  lost: number;
  pending: number;
}

interface Props {
  engine: string;
  stats: EnginePerformance;
}

const ENGINE_EMOJIS: Record<string, string> = {
  'Sharp Money': '⚡',
  'Sharp': '⚡',
  'God Mode': '🔮',
  'Juiced Props': '🍊',
  'Juiced': '🍊',
  'HitRate': '🎯',
  'AI Parlay': '🤖',
  'Fatigue Edge': '💤',
  'Fatigue': '💤',
  'FanDuel Trap': '🪤',
  'FanDuel': '🪤',
  'Unified Props': '📊',
  'Unified': '📊',
};

export function EnginePerformanceCard({ engine, stats }: Props) {
  const verified = stats.won + stats.lost;
  const winRate = verified > 0 ? (stats.won / verified) * 100 : 0;
  const emoji = ENGINE_EMOJIS[engine] || '📈';

  const getWinRateColor = (rate: number) => {
    if (rate >= 60) return 'text-green-500';
    if (rate >= 50) return 'text-yellow-500';
    return 'text-red-500';
  };

  const shortName = engine.split(' ')[0];

  return (
    <Card className="bg-card/50 hover:bg-card/80 transition-colors">
      <CardContent className="p-2 text-center">
        <div className="text-lg mb-0.5">{emoji}</div>
        <div className="text-[10px] font-medium truncate" title={engine}>
          {shortName}
        </div>
        <div className={`text-sm font-bold ${getWinRateColor(winRate)}`}>
          {verified > 0 ? `${winRate.toFixed(0)}%` : '-'}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {stats.won}W-{stats.lost}L
        </div>
        <Progress 
          value={winRate} 
          className="h-1 mt-1"
        />
        {stats.pending > 0 && (
          <div className="text-[9px] text-yellow-500 mt-0.5">
            {stats.pending} live
          </div>
        )}
      </CardContent>
    </Card>
  );
}
