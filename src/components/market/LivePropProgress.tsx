import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Activity, Radio } from "lucide-react";

interface LivePropProgressProps {
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  currentValue: number;
  gameProgress: number;
  period: string | null;
  clock: string | null;
  isLive: boolean;
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

export function LivePropProgress({
  playerName,
  propType,
  line,
  side,
  currentValue,
  gameProgress,
  period,
  clock,
  isLive,
}: LivePropProgressProps) {
  // Calculate progress percentage toward the line
  const progressPercent = line > 0 ? Math.min((currentValue / line) * 100, 150) : 0;
  
  // Calculate projected final value based on game progress
  const projectedValue = gameProgress > 0 
    ? Math.round((currentValue / (gameProgress / 100)) * 10) / 10
    : currentValue;
  
  // Determine if on pace to hit
  const isOnPace = side === 'over' 
    ? projectedValue > line 
    : projectedValue < line;
  
  // For UNDER: we're "winning" when current value is below the line
  // For OVER: we're "winning" when current value is above the pace needed
  const pacePercent = gameProgress > 0 ? (line * (gameProgress / 100)) : 0;
  const isWinning = side === 'over' 
    ? currentValue >= pacePercent 
    : currentValue <= pacePercent;

  // Determine color based on pace
  const getProgressColor = () => {
    if (side === 'over') {
      if (currentValue >= line) return 'bg-green-500'; // Already hit
      if (isOnPace) return 'bg-green-500/80';
      if (projectedValue >= line * 0.85) return 'bg-amber-500';
      return 'bg-red-500';
    } else {
      // UNDER: lower is better
      if (gameProgress >= 100 && currentValue < line) return 'bg-green-500'; // Won
      if (isOnPace) return 'bg-green-500/80';
      if (projectedValue <= line * 1.15) return 'bg-amber-500';
      return 'bg-red-500';
    }
  };

  const TrendIcon = side === 'over' ? TrendingUp : TrendingDown;
  const alreadyHit = side === 'over' && currentValue >= line;
  const alreadyMissed = side === 'under' && currentValue >= line;

  return (
    <div className="w-full space-y-2">
      {/* Live Badge + Game Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isLive && (
            <motion.div 
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-red-500/20 border border-red-500/40"
              animate={{ opacity: [1, 0.6, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <Radio className="w-3 h-3 text-red-400" />
              <span className="text-xs font-bold text-red-400">LIVE</span>
            </motion.div>
          )}
          {period && (
            <span className="text-xs font-medium text-muted-foreground">
              {period} {clock && `• ${clock}`}
            </span>
          )}
        </div>
        
        {/* Pace indicator */}
        <div className="flex items-center gap-1.5">
          {alreadyHit ? (
            <span className="text-xs font-bold text-green-400">✓ HIT</span>
          ) : alreadyMissed ? (
            <span className="text-xs font-bold text-red-400">✗ BUST</span>
          ) : (
            <>
              <Activity className={cn(
                "w-3 h-3",
                isOnPace ? "text-green-400" : "text-amber-400"
              )} />
              <span className={cn(
                "text-xs font-medium",
                isOnPace ? "text-green-400" : "text-amber-400"
              )}>
                {isOnPace ? "On Pace" : "Behind"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative h-6 bg-muted/50 rounded-md overflow-hidden">
        {/* Progress fill */}
        <motion.div
          className={cn("absolute inset-y-0 left-0 rounded-md", getProgressColor())}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(progressPercent, 100)}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        
        {/* Line marker */}
        <div 
          className="absolute top-0 bottom-0 w-0.5 bg-foreground/60"
          style={{ left: `${Math.min((100 / 150) * 100, 66.67)}%` }}
        >
          <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-foreground/60" />
        </div>
        
        {/* Current value + line text */}
        <div className="absolute inset-0 flex items-center justify-between px-3">
          <span className="text-sm font-bold text-foreground drop-shadow-md">
            {currentValue}
          </span>
          <div className="flex items-center gap-1.5">
            <TrendIcon className="w-3 h-3 text-foreground/70" />
            <span className="text-sm font-medium text-foreground/70 capitalize">
              {side} {line}
            </span>
          </div>
        </div>
      </div>

      {/* Stat Type + Projection */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {formatPropType(propType)}
        </span>
        {gameProgress > 0 && gameProgress < 100 && !alreadyHit && !alreadyMissed && (
          <span className={cn(
            "font-medium",
            isOnPace ? "text-green-400" : "text-amber-400"
          )}>
            Proj: {projectedValue.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}
