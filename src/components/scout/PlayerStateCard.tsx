import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { PlayerLiveState, InjuryStatus } from '@/types/scout-agent';
import { AlertTriangle, Zap, Activity, Target, HeartPulse } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlayerStateCardProps {
  player: PlayerLiveState;
  compact?: boolean;
}

// Get injury badge styling based on status
const getInjuryBadgeStyle = (status: InjuryStatus) => {
  switch (status) {
    case 'OUT':
      return 'bg-destructive/20 text-destructive border-destructive';
    case 'DOUBTFUL':
      return 'bg-amber-500/20 text-amber-400 border-amber-500';
    case 'QUESTIONABLE':
    case 'DTD':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500';
    case 'GTD':
      return 'bg-blue-500/20 text-blue-400 border-blue-500';
    default:
      return '';
  }
};

export function PlayerStateCard({ player, compact = false }: PlayerStateCardProps) {
  const fatigueColor = player.fatigueScore >= 80 
    ? 'text-destructive' 
    : player.fatigueScore >= 60 
    ? 'text-chart-4' 
    : player.fatigueScore >= 40 
    ? 'text-chart-3' 
    : 'text-chart-2';

  const speedColor = player.speedIndex >= 70 
    ? 'text-chart-2' 
    : player.speedIndex >= 50 
    ? 'text-chart-3' 
    : 'text-chart-4';

  const roleIcon = {
    PRIMARY: <Zap className="w-3 h-3" />,
    SECONDARY: <Activity className="w-3 h-3" />,
    BIG: <Target className="w-3 h-3" />,
    SPACER: null,
  };

  if (compact) {
    return (
      <div className={cn(
        "flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg",
        player.injuryStatus === 'OUT' && "opacity-50"
      )}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">#{player.jersey}</span>
          <span className="font-medium text-sm">{player.playerName.split(' ').pop()}</span>
          {roleIcon[player.role]}
          {player.injuryStatus && (
            <Badge 
              variant="outline" 
              className={cn("text-[10px] px-1 py-0", getInjuryBadgeStyle(player.injuryStatus))}
            >
              {player.injuryStatus}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className={cn("text-xs font-medium", fatigueColor)}>
              F:{player.fatigueScore}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className={cn("text-xs font-medium", speedColor)}>
              S:{player.speedIndex}
            </span>
          </div>
          {player.fatigueScore >= 70 && (
            <AlertTriangle className="w-3 h-3 text-destructive animate-pulse" />
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className={cn(
      "border-border/50 transition-colors",
      player.fatigueScore >= 70 && "border-destructive/50 bg-destructive/5"
    )}>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg text-muted-foreground">#{player.jersey}</span>
            <div>
              <p className="font-semibold">{player.playerName}</p>
              <p className="text-xs text-muted-foreground">{player.team}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-xs">
              {player.role}
            </Badge>
            {player.injuryStatus && (
              <Badge 
                variant="outline" 
                className={cn("text-xs", getInjuryBadgeStyle(player.injuryStatus))}
              >
                <HeartPulse className="w-3 h-3 mr-1" />
                {player.injuryStatus}
              </Badge>
            )}
            {player.onCourt && !player.injuryStatus && (
              <Badge variant="default" className="text-xs bg-chart-2">
                ON
              </Badge>
            )}
          </div>
        </div>
        
        {/* Injury Detail */}
        {player.injuryDetail && (
          <p className="text-xs text-muted-foreground mt-1">{player.injuryDetail}</p>
        )}

        {/* Fatigue Meter */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Fatigue</span>
            <span className={cn("font-medium", fatigueColor)}>{player.fatigueScore}%</span>
          </div>
          <Progress 
            value={player.fatigueScore} 
            className={cn(
              "h-2",
              player.fatigueScore >= 80 && "[&>div]:bg-destructive",
              player.fatigueScore >= 60 && player.fatigueScore < 80 && "[&>div]:bg-chart-4",
              player.fatigueScore >= 40 && player.fatigueScore < 60 && "[&>div]:bg-chart-3",
              player.fatigueScore < 40 && "[&>div]:bg-chart-2"
            )}
          />
        </div>

        {/* Speed Index */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Speed</span>
            <span className={cn("font-medium", speedColor)}>{player.speedIndex}%</span>
          </div>
          <Progress 
            value={player.speedIndex} 
            className="h-2"
          />
        </div>

        {/* Stats Row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>~{Math.round(player.minutesEstimate)} min</span>
          <span>Fouls: {player.foulCount}</span>
          <span className="font-mono">{player.lastUpdated}</span>
        </div>

        {/* Visual Flags */}
        {player.visualFlags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {player.visualFlags.slice(-3).map((flag, idx) => (
              <Badge key={idx} variant="secondary" className="text-[10px]">
                {flag}
              </Badge>
            ))}
          </div>
        )}

        {/* Fatigue Warning */}
        {player.fatigueScore >= 70 && (
          <div className="flex items-center gap-2 p-2 bg-destructive/10 rounded text-xs text-destructive">
            <AlertTriangle className="w-3 h-3" />
            <span>Fatigue spike detected - consider UNDERS</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
