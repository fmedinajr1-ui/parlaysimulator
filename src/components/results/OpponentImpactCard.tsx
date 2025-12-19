import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Swords, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from "lucide-react";

interface OpponentImpactCardProps {
  playerName: string;
  opponent: string;
  propType: string;
  overallHitRate: number;
  overallMedian: number;
  vsOpponentHitRate: number;
  vsOpponentMedian: number;
  vsOpponentGames: number;
  blendedHitRate: number;
  blendedMedian: number;
  impact: 'BOOST' | 'NEUTRAL' | 'CAUTION' | 'FADE';
}

const impactConfig = {
  BOOST: {
    bg: 'bg-neon-green/15',
    border: 'border-neon-green/50',
    text: 'text-neon-green',
    icon: TrendingUp,
    label: '🚀 BOOST',
    description: 'Player DOMINATES this matchup',
  },
  NEUTRAL: {
    bg: 'bg-muted/50',
    border: 'border-border/50',
    text: 'text-muted-foreground',
    icon: CheckCircle2,
    label: '⚖️ NEUTRAL',
    description: 'Normal performance vs this team',
  },
  CAUTION: {
    bg: 'bg-neon-yellow/15',
    border: 'border-neon-yellow/50',
    text: 'text-neon-yellow',
    icon: AlertTriangle,
    label: '⚠️ CAUTION',
    description: 'Mixed historical results',
  },
  FADE: {
    bg: 'bg-neon-red/15',
    border: 'border-neon-red/50',
    text: 'text-neon-red',
    icon: TrendingDown,
    label: '🚫 FADE',
    description: 'Player STRUGGLES vs this team',
  },
};

export function OpponentImpactCard({
  playerName,
  opponent,
  propType,
  overallHitRate,
  overallMedian,
  vsOpponentHitRate,
  vsOpponentMedian,
  vsOpponentGames,
  blendedHitRate,
  blendedMedian,
  impact,
}: OpponentImpactCardProps) {
  const config = impactConfig[impact];
  const IconComponent = config.icon;
  
  const medianDiff = vsOpponentMedian - overallMedian;
  const hitRateDiff = vsOpponentHitRate - overallHitRate;
  
  const formatPropType = (type: string) => {
    return type.replace('player_', '').replace(/_/g, ' ').toUpperCase();
  };

  return (
    <div className={cn(
      "mt-3 p-4 rounded-xl border transition-all",
      config.bg,
      config.border,
      impact === 'FADE' && "animate-pulse"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Swords className={cn("w-5 h-5", config.text)} />
          <div>
            <span className="text-sm font-bold">vs {opponent}</span>
            <p className="text-xs text-muted-foreground">
              {vsOpponentGames} historical game{vsOpponentGames !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Badge variant="outline" className={cn("text-xs font-bold", config.text, config.border)}>
          {config.label}
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        {/* Overall Column */}
        <div className="p-2 rounded-lg bg-background/50">
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Overall</p>
          <p className="text-sm font-bold text-foreground">
            {(overallHitRate * 100).toFixed(0)}%
          </p>
          <p className="text-xs text-muted-foreground">
            {overallMedian.toFixed(1)} med
          </p>
        </div>

        {/* vs Opponent Column */}
        <div className={cn("p-2 rounded-lg border", config.bg, config.border)}>
          <p className="text-[10px] text-muted-foreground uppercase mb-1">vs {opponent.slice(0, 3)}</p>
          <p className={cn("text-sm font-bold", config.text)}>
            {(vsOpponentHitRate * 100).toFixed(0)}%
          </p>
          <p className="text-xs text-muted-foreground">
            {vsOpponentMedian.toFixed(1)} med
          </p>
        </div>

        {/* Blended Column */}
        <div className="p-2 rounded-lg bg-neon-purple/10 border border-neon-purple/30">
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Blended</p>
          <p className="text-sm font-bold text-neon-purple">
            {(blendedHitRate * 100).toFixed(0)}%
          </p>
          <p className="text-xs text-muted-foreground">
            {blendedMedian.toFixed(1)} adj
          </p>
        </div>
      </div>

      {/* Differential Summary */}
      <div className={cn(
        "flex items-center gap-2 p-2 rounded-lg",
        config.bg
      )}>
        <IconComponent className={cn("w-4 h-4 shrink-0", config.text)} />
        <div className="flex-1 min-w-0">
          <p className={cn("text-xs font-medium", config.text)}>
            {config.description}
          </p>
          <p className="text-xs text-muted-foreground">
            {medianDiff >= 0 ? '+' : ''}{medianDiff.toFixed(1)} {formatPropType(propType)} differential 
            {' • '}
            {hitRateDiff >= 0 ? '+' : ''}{(hitRateDiff * 100).toFixed(0)}% hit rate change
          </p>
        </div>
      </div>

      {/* Strong warning for FADE */}
      {impact === 'FADE' && (
        <div className="mt-2 p-2 rounded-lg bg-neon-red/20 border border-neon-red/50">
          <p className="text-xs text-neon-red font-medium flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Consider fading or avoiding this leg
          </p>
        </div>
      )}
    </div>
  );
}
