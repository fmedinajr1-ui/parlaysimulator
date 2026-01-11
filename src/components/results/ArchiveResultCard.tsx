import { cn } from "@/lib/utils";
import { Check, X, Minus, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { ArchiveResult } from "@/hooks/useArchiveResults";

interface ArchiveResultCardProps {
  result: ArchiveResult;
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
  return typeMap[propType?.toLowerCase()] || propType?.toUpperCase() || 'PROP';
}

export function ArchiveResultCard({ result }: ArchiveResultCardProps) {
  const outcome = result.outcome || 'pending';
  const isWin = outcome === 'hit';
  const isLoss = outcome === 'miss';
  const isPush = outcome === 'push';
  const isPending = outcome === 'pending' || !result.outcome;

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
    pending: {
      label: 'PENDING',
      icon: Clock,
      bgClass: 'bg-blue-500/10 border-blue-500/30',
      badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      iconClass: 'text-blue-400',
    },
  };

  const config = outcomeConfig[outcome as keyof typeof outcomeConfig] || outcomeConfig.pending;
  const Icon = config.icon;
  const TrendIcon = result.side === 'over' ? TrendingUp : TrendingDown;

  // For parlays, show a different layout
  if (result.is_parlay && result.parlay_legs) {
    const legs = result.parlay_legs;
    return (
      <div className={cn(
        "p-3 rounded-lg border transition-colors",
        config.bgClass
      )}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold",
              config.badgeClass
            )}>
              <Icon className={cn("w-3.5 h-3.5", config.iconClass)} />
              <span>{config.label}</span>
            </div>
            <span className="text-sm font-medium">{legs.length}-Leg Parlay</span>
            {result.parlay_type && (
              <span className="text-xs px-2 py-0.5 rounded bg-muted/50 text-muted-foreground">
                {result.parlay_type}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground capitalize">{result.engine}</span>
        </div>
        <div className="space-y-1 pl-2 border-l-2 border-border/50">
          {legs.map((leg: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className={cn(
                "w-4 h-4 rounded-full flex items-center justify-center text-[10px]",
                leg.outcome === 'hit' ? 'bg-green-500/20 text-green-400' :
                leg.outcome === 'miss' ? 'bg-red-500/20 text-red-400' :
                'bg-muted/50 text-muted-foreground'
              )}>
                {leg.outcome === 'hit' ? '✓' : leg.outcome === 'miss' ? '✗' : '?'}
              </span>
              <span className="text-muted-foreground">{leg.player_name}</span>
              <span className="text-xs">{formatPropType(leg.prop_type)}</span>
              <span className="text-xs capitalize">{leg.side}</span>
              <span className="text-xs font-medium">{leg.line}</span>
              {leg.actual_value != null && (
                <span className="text-xs text-muted-foreground">({leg.actual_value})</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

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

      {/* Right: Actual Value + Engine */}
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
        {result.confidence_score && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Conf:</span>
            <span className="text-xs font-medium text-foreground">
              {result.confidence_score.toFixed(1)}
            </span>
          </div>
        )}
        <span className="text-[10px] text-muted-foreground capitalize">
          {result.engine}
        </span>
      </div>
    </div>
  );
}
