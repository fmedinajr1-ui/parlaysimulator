import { TrendingUp, TrendingDown, Minus, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LivePropData } from "@/types/sweetSpot";

interface LiveDataOverlayProps {
  liveData: LivePropData;
  line: number;
  side: 'over' | 'under';
}

export function LiveDataOverlay({ liveData, line, side }: LiveDataOverlayProps) {
  const { 
    currentValue, 
    projectedFinal, 
    gameProgress, 
    period, 
    clock, 
    trend,
    riskFlags,
    confidence 
  } = liveData;
  
  // Determine if on track to hit
  const isOnTrack = side === 'over' 
    ? projectedFinal >= line 
    : projectedFinal <= line;
  
  // Get trend icon
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  
  return (
    <div className={cn(
      "p-2 rounded-lg border",
      isOnTrack 
        ? "bg-green-500/10 border-green-500/30" 
        : "bg-red-500/10 border-red-500/30"
    )}>
      {/* Header with live indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="text-xs text-green-400 font-medium">LIVE</span>
          <span className="text-xs text-muted-foreground">
            Q{period} {clock}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <TrendIcon className={cn(
            "w-3 h-3",
            trend === 'up' ? "text-green-400" :
            trend === 'down' ? "text-red-400" : "text-muted-foreground"
          )} />
          <span className="text-sm font-bold font-mono">
            {currentValue}
          </span>
          <span className="text-xs text-muted-foreground">→</span>
          <span className={cn(
            "text-sm font-bold font-mono",
            isOnTrack ? "text-green-400" : "text-red-400"
          )}>
            {projectedFinal.toFixed(1)}
          </span>
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn(
            "h-full transition-all duration-500",
            isOnTrack ? "bg-green-500" : "bg-red-500"
          )}
          style={{ width: `${gameProgress}%` }}
        />
      </div>
      
      {/* Confidence + Line status */}
      <div className="mt-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Confidence:</span>
          <span className={cn(
            "font-medium",
            confidence >= 70 ? "text-green-400" :
            confidence >= 50 ? "text-yellow-400" : "text-red-400"
          )}>
            {confidence}%
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Need:</span>
          <span className="font-mono font-medium text-foreground">
            {side === 'over' 
              ? Math.max(0, line - currentValue + 0.5).toFixed(1)
              : currentValue < line ? '✓' : (currentValue - line + 0.5).toFixed(1)
            }
          </span>
          {side === 'over' && currentValue > line && (
            <span className="text-green-400">✓</span>
          )}
        </div>
      </div>
      
      {/* Risk flags */}
      {riskFlags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {riskFlags.map(flag => (
            <span 
              key={flag} 
              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded"
            >
              <AlertCircle className="w-3 h-3" />
              {flag === 'foul_trouble' ? 'Foul Trouble' : 
               flag === 'blowout' ? 'Blowout Risk' :
               flag === 'garbage_time' ? 'Garbage Time' :
               flag === 'low_minutes' ? 'Low Minutes' : flag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
