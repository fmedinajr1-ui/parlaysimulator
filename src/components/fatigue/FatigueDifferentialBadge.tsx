import { Battery, BatteryLow, BatteryMedium, BatteryFull, Zap, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useFatigueData, getFatigueByTeam } from '@/hooks/useFatigueData';

interface FatigueDifferentialBadgeProps {
  homeTeam: string;
  awayTeam: string;
  compact?: boolean;
}

const getFatigueColor = (score: number): string => {
  if (score <= 20) return 'text-green-400';
  if (score <= 40) return 'text-yellow-400';
  if (score <= 60) return 'text-orange-400';
  return 'text-red-400';
};

const getFatigueBgColor = (score: number): string => {
  if (score <= 20) return 'bg-green-500/20 border-green-500/30';
  if (score <= 40) return 'bg-yellow-500/20 border-yellow-500/30';
  if (score <= 60) return 'bg-orange-500/20 border-orange-500/30';
  return 'bg-red-500/20 border-red-500/30';
};

const getFatigueIcon = (score: number) => {
  if (score <= 20) return BatteryFull;
  if (score <= 40) return BatteryMedium;
  if (score <= 60) return BatteryLow;
  return Battery;
};

const getFatigueEmoji = (score: number): string => {
  if (score <= 20) return '🟢';
  if (score <= 40) return '🟡';
  if (score <= 60) return '🟠';
  return '🔴';
};

const getFatigueLabel = (score: number): string => {
  if (score <= 20) return 'Fresh';
  if (score <= 40) return 'Good';
  if (score <= 60) return 'Tired';
  return 'Gassed';
};

export function FatigueDifferentialBadge({ homeTeam, awayTeam, compact = false }: FatigueDifferentialBadgeProps) {
  const { data: fatigueData, isLoading } = useFatigueData();
  
  const homeFatigue = getFatigueByTeam(fatigueData, homeTeam);
  const awayFatigue = getFatigueByTeam(fatigueData, awayTeam);
  
  // Need both teams' fatigue data
  if (isLoading || !homeFatigue || !awayFatigue) {
    return null;
  }
  
  const homeScore = homeFatigue.fatigue_score;
  const awayScore = awayFatigue.fatigue_score;
  const differential = Math.abs(homeScore - awayScore);
  
  // Only show if differential is significant (>= 15)
  if (differential < 15) {
    return null;
  }
  
  const advantageTeam = homeScore > awayScore ? awayTeam : homeTeam;
  const advantageScore = homeScore > awayScore ? awayScore : homeScore;
  const disadvantageTeam = homeScore > awayScore ? homeTeam : awayTeam;
  const disadvantageScore = homeScore > awayScore ? homeScore : awayScore;
  
  const HomeIcon = getFatigueIcon(homeScore);
  const AwayIcon = getFatigueIcon(awayScore);
  
  if (compact) {
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "text-xs border",
          differential >= 30 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
          "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
        )}
      >
        <Zap className="w-3 h-3 mr-1" />
        +{differential} Fatigue Edge
      </Badge>
    );
  }
  
  return (
    <div className="mt-2 p-2.5 rounded-lg border bg-muted/30 border-border/50">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
        <Zap className="w-3.5 h-3.5 text-yellow-400" />
        <span className="font-medium text-foreground">Fatigue Advantage</span>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mb-2">
        {/* Home Team */}
        <div className={cn(
          "flex items-center gap-2 p-1.5 rounded border",
          getFatigueBgColor(homeScore)
        )}>
          <HomeIcon className={cn("w-4 h-4", getFatigueColor(homeScore))} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{homeTeam}</p>
            <div className="flex items-center gap-1">
              <span className={cn("text-sm font-bold", getFatigueColor(homeScore))}>
                {homeScore}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {getFatigueEmoji(homeScore)} {getFatigueLabel(homeScore)}
              </span>
            </div>
          </div>
        </div>
        
        {/* Away Team */}
        <div className={cn(
          "flex items-center gap-2 p-1.5 rounded border",
          getFatigueBgColor(awayScore)
        )}>
          <AwayIcon className={cn("w-4 h-4", getFatigueColor(awayScore))} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{awayTeam}</p>
            <div className="flex items-center gap-1">
              <span className={cn("text-sm font-bold", getFatigueColor(awayScore))}>
                {awayScore}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {getFatigueEmoji(awayScore)} {getFatigueLabel(awayScore)}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Differential Badge */}
      <div className={cn(
        "flex items-center justify-center gap-2 p-1.5 rounded-md",
        differential >= 30 ? "bg-emerald-500/20 border border-emerald-500/30" :
        "bg-yellow-500/20 border border-yellow-500/30"
      )}>
        {differential >= 30 ? (
          <AlertTriangle className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Zap className="w-3.5 h-3.5 text-yellow-400" />
        )}
        <span className={cn(
          "text-xs font-bold",
          differential >= 30 ? "text-emerald-400" : "text-yellow-400"
        )}>
          {advantageTeam.toUpperCase()} +{differential} FATIGUE EDGE
        </span>
      </div>
      
      {/* Fatigue factors if significant */}
      {(homeFatigue.is_back_to_back || awayFatigue.is_back_to_back) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {homeFatigue.is_back_to_back && (
            <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/20">
              {homeTeam} B2B
            </Badge>
          )}
          {awayFatigue.is_back_to_back && (
            <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/20">
              {awayTeam} B2B
            </Badge>
          )}
          {homeFatigue.is_altitude_game && (
            <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/20">
              Altitude
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
