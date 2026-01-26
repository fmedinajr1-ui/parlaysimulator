import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { PlayerLiveState, InjuryStatus, PropEdge } from '@/types/scout-agent';
import { AlertTriangle, Zap, Activity, Target, HeartPulse } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlayerStateCardProps {
  player: PlayerLiveState;
  compact?: boolean;
  playerPropEdges?: PropEdge[];
}

// Get specific UNDER recommendations based on player role and fatigue signals
function getFatigueUnderRecommendations(
  player: PlayerLiveState, 
  edges: PropEdge[]
): { prop: string; reason: string; line?: number }[] {
  const recommendations: { prop: string; reason: string; line?: number }[] = [];
  
  // Normalize player name for matching
  const playerLastName = player.playerName.split(' ').pop()?.toLowerCase() || '';
  const availableProps = edges.filter(e => 
    e.player.toLowerCase().includes(playerLastName)
  );
  
  if (availableProps.length === 0) return recommendations;
  
  // Role-based logic
  if (player.role === 'PRIMARY' || player.role === 'SECONDARY') {
    const pointsEdge = availableProps.find(e => e.prop === 'Points');
    const praEdge = availableProps.find(e => e.prop === 'PRA');
    
    if (pointsEdge) {
      let reason = 'Fatigue reducing efficiency';
      if (player.speedIndex < 50) reason = 'Low speed affecting drives';
      else if (player.fatigueScore >= 80) reason = 'Severe fatigue limiting output';
      
      recommendations.push({ prop: 'Points', line: pointsEdge.line, reason });
    }
    if (praEdge) {
      recommendations.push({ 
        prop: 'PRA', 
        line: praEdge.line, 
        reason: 'Overall production declining' 
      });
    }
  }
  
  if (player.role === 'BIG') {
    const reboundsEdge = availableProps.find(e => e.prop === 'Rebounds');
    const praEdge = availableProps.find(e => e.prop === 'PRA');
    
    if (reboundsEdge) {
      recommendations.push({
        prop: 'Rebounds',
        line: reboundsEdge.line,
        reason: 'Fatigue reducing effort on glass'
      });
    }
    if (praEdge) {
      recommendations.push({
        prop: 'PRA',
        line: praEdge.line,
        reason: 'Overall activity declining'
      });
    }
  }
  
  if (player.role === 'SPACER') {
    const threesEdge = availableProps.find(e => e.prop === 'Threes');
    if (threesEdge) {
      recommendations.push({
        prop: 'Threes',
        line: threesEdge.line,
        reason: 'Tired legs affecting shooting form'
      });
    }
  }
  
  // Add assists for playmakers
  const assistsEdge = availableProps.find(e => e.prop === 'Assists');
  if (assistsEdge && (player.role === 'PRIMARY' || player.role === 'SECONDARY')) {
    recommendations.push({
      prop: 'Assists',
      line: assistsEdge.line,
      reason: player.speedIndex < 50 ? 'Slower pace limiting playmaking' : 'Reduced court vision'
    });
  }
  
  // Add visual signal context
  const hasVisibleSigns = player.visualFlags.some(f => 
    f.includes('fatigue') || f.includes('tired') || f.includes('slow')
  );
  if (hasVisibleSigns) {
    recommendations.forEach(r => {
      r.reason += ' • Visible fatigue signs';
    });
  }
  
  return recommendations.slice(0, 3); // Max 3 recommendations
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

export function PlayerStateCard({ player, compact = false, playerPropEdges = [] }: PlayerStateCardProps) {
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
          <div className="flex items-center gap-1 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {player.role}
            </Badge>
            {player.rotation?.rotationRole && player.rotation.rotationRole !== 'STARTER' && (
              <Badge variant="outline" className={cn(
                "text-[10px]",
                player.rotation.rotationRole === 'CLOSER' && "bg-chart-2/20 text-chart-2 border-chart-2/50",
                player.rotation.rotationRole === 'BENCH_FRINGE' && "bg-chart-4/20 text-chart-4 border-chart-4/50"
              )}>
                {player.rotation.rotationRole.replace('_', ' ')}
              </Badge>
            )}
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

        {/* Enhanced Fatigue Warning with Specific Props */}
        {player.fatigueScore >= 70 && (
          <div className="p-2 bg-destructive/10 rounded space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-destructive font-medium">
              <AlertTriangle className="w-3 h-3" />
              <span>Fatigue spike: {player.fatigueScore}%</span>
            </div>
            
            {playerPropEdges.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Consider UNDER on:
                </p>
                {getFatigueUnderRecommendations(player, playerPropEdges).map((rec, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="bg-destructive/20 text-destructive border-destructive/30 text-[10px] px-1.5 py-0">
                      {rec.prop} {rec.line && `U${rec.line}`}
                    </Badge>
                    <span className="text-muted-foreground text-[10px]">{rec.reason}</span>
                  </div>
                ))}
                {getFatigueUnderRecommendations(player, playerPropEdges).length === 0 && (
                  <p className="text-[10px] text-muted-foreground">No matching props for role</p>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">No active prop lines available</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
