import { TrendingDown } from 'lucide-react';

interface PropImpactTableProps {
  pointsAdjustment: number;
  reboundsAdjustment: number;
  assistsAdjustment: number;
  threePtAdjustment: number;
  blocksAdjustment: number;
  teamName: string;
}

export const PropImpactTable = ({
  pointsAdjustment,
  reboundsAdjustment,
  assistsAdjustment,
  threePtAdjustment,
  blocksAdjustment,
  teamName,
}: PropImpactTableProps) => {
  const props = [
    { name: 'Points', adjustment: pointsAdjustment, icon: '🏀' },
    { name: 'Rebounds', adjustment: reboundsAdjustment, icon: '📊' },
    { name: 'Assists', adjustment: assistsAdjustment, icon: '🎯' },
    { name: '3PT%', adjustment: threePtAdjustment, icon: '🎱' },
    { name: 'Blocks', adjustment: blocksAdjustment, icon: '🖐️' },
  ];

  const getImpactColor = (adjustment: number): string => {
    if (adjustment >= -5) return 'text-green-400';
    if (adjustment >= -10) return 'text-yellow-400';
    if (adjustment >= -15) return 'text-orange-400';
    return 'text-red-400';
  };

  const getImpactBg = (adjustment: number): string => {
    if (adjustment >= -5) return 'bg-green-500/10';
    if (adjustment >= -10) return 'bg-yellow-500/10';
    if (adjustment >= -15) return 'bg-orange-500/10';
    return 'bg-red-500/10';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <TrendingDown className="w-3 h-3" />
        <span>Prop Adjustments for {teamName} players</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {props.map((prop) => (
          <div
            key={prop.name}
            className={`rounded-lg p-2 text-center ${getImpactBg(prop.adjustment)}`}
          >
            <div className="text-xs mb-1">{prop.icon}</div>
            <div className="text-xs font-medium text-foreground">{prop.name}</div>
            <div className={`text-sm font-bold ${getImpactColor(prop.adjustment)}`}>
              {prop.adjustment > 0 ? '+' : ''}{prop.adjustment.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
