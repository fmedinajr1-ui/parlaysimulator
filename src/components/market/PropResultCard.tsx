import { cn } from "@/lib/utils";
import { Check, X, Minus, TrendingUp, TrendingDown } from "lucide-react";
import { PropResult } from "@/hooks/usePropResults";
import { format, parseISO } from "date-fns";

interface PropResultCardProps {
  result: PropResult;
}

function formatPropType(propType: string): string {
  const typeMap: Record<string, string> = {
    'player_points': 'PTS',
    'player_rebounds': 'REB',
    'player_assists': 'AST',
    'player_threes': '3PM',
    'player_blocks': 'BLK',
    'player_steals': 'STL',
    'player_turnovers': 'TO',
    'player_points_rebounds': 'PTS+REB',
    'player_points_assists': 'PTS+AST',
    'player_rebounds_assists': 'REB+AST',
    'player_points_rebounds_assists': 'PRA',
    'points': 'PTS',
    'rebounds': 'REB',
    'assists': 'AST',
    'threes': '3PM',
  };
  return typeMap[propType.toLowerCase()] || propType.toUpperCase();
}

export function PropResultCard({ result }: PropResultCardProps) {
  const isWin = result.outcome === 'hit';
  const isLoss = result.outcome === 'miss';
  const isPush = result.outcome === 'push';

  const outcomeConfig = {
    hit: {
      label: 'WON',
      icon: Check,
      bgClass: 'bg-green-500/10 border-green-500/30',
      badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
      iconClass: 'text-green-400',
    },
    miss: {
      label: 'LOST',
      icon: X,
      bgClass: 'bg-red-500/10 border-red-500/30',
      badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
      iconClass: 'text-red-400',
    },
    push: {
      label: 'PUSH',
      icon: Minus,
      bgClass: 'bg-amber-500/10 border-amber-500/30',
      badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      iconClass: 'text-amber-400',
    },
  };

  const config = outcomeConfig[result.outcome];
  const Icon = config.icon;
  const TrendIcon = result.side === 'over' ? TrendingUp : TrendingDown;

  return (
    <div className={cn(
      "flex items-center justify-between p-3 rounded-lg border transition-colors",
      config.bgClass
    )}>
      {/* Left: Outcome Badge + Player Info */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Outcome Badge */}
        <div className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold shrink-0",
          config.badgeClass
        )}>
          <Icon className={cn("w-3.5 h-3.5", config.iconClass)} />
          <span>{config.label}</span>
        </div>

        {/* Player & Prop Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground truncate">
              {result.player_name}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatPropType(result.prop_type)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendIcon className="w-3 h-3" />
            <span className="capitalize">{result.side}</span>
            <span className="font-medium">{result.line}</span>
            {result.team_name && (
              <span className="text-xs">• {result.team_name}</span>
            )}
          </div>
        </div>
      </div>

      {/* Right: Actual Value + Confidence */}
      <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
        {result.actual_value !== null && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Actual:</span>
            <span className={cn(
              "text-sm font-bold",
              isWin && "text-green-400",
              isLoss && "text-red-400",
              isPush && "text-amber-400"
            )}>
              {result.actual_value}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Confidence:</span>
          <span className="text-xs font-medium text-foreground">
            {result.confidence_score.toFixed(1)}
          </span>
        </div>
        {result.settled_at && (
          <span className="text-[10px] text-muted-foreground">
            {format(parseISO(result.settled_at), 'h:mm a')}
          </span>
        )}
      </div>
    </div>
  );
}
