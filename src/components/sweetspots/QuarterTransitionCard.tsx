import { Bell, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import type { DeepSweetSpot, QuarterTransitionAlert } from "@/types/sweetSpot";

interface QuarterTransitionCardProps {
  transition: QuarterTransitionAlert;
  spot: DeepSweetSpot;
}

// Get colors based on transition status
function getTransitionColors(status: QuarterTransitionAlert['status']): {
  bg: string;
  border: string;
  text: string;
  badge: string;
} {
  switch (status) {
    case 'ahead':
      return {
        bg: 'bg-primary/10',
        border: 'border-primary/30',
        text: 'text-primary',
        badge: 'bg-primary text-primary-foreground',
      };
    case 'on_track':
      return {
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30',
        text: 'text-emerald-500',
        badge: 'bg-emerald-500 text-white',
      };
    case 'behind':
      return {
        bg: 'bg-warning/10',
        border: 'border-warning/30',
        text: 'text-warning',
        badge: 'bg-warning text-warning-foreground',
      };
    case 'critical':
      return {
        bg: 'bg-destructive/10',
        border: 'border-destructive/30',
        text: 'text-destructive',
        badge: 'bg-destructive text-destructive-foreground',
      };
  }
}

export function QuarterTransitionCard({ transition, spot }: QuarterTransitionCardProps) {
  const colors = getTransitionColors(transition.status);
  const progressPercent = spot.line > 0 ? (transition.currentTotal / spot.line) * 100 : 0;
  const expectedAtQuarter = transition.expectedQuarterValue * transition.quarter;
  
  // Calculate velocity delta percentage safely
  const velocityDeltaPct = transition.neededVelocity > 0 
    ? ((transition.velocityDelta / transition.neededVelocity) * 100) 
    : 0;
  
  return (
    <div className={cn("p-3 rounded-lg border mb-3", colors.bg, colors.border)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Bell className="w-4 h-4" />
        <span className={cn("font-bold text-sm", colors.text)}>
          🔔 {transition.headline}
        </span>
        <span className={cn("ml-auto px-2 py-0.5 rounded text-xs font-bold", colors.badge)}>
          {transition.status.toUpperCase().replace('_', ' ')}
        </span>
      </div>
      
      {/* Progress Bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span>
            Q{transition.quarter}: <span className="font-mono font-bold">{transition.currentTotal}</span>
          </span>
          <span>
            Need: <span className="font-mono font-bold">{spot.line}</span>
          </span>
        </div>
        <Progress value={Math.min(100, progressPercent)} className="h-2" />
        <div className="flex justify-between text-xs mt-1 text-muted-foreground">
          <span>
            Expected: <span className="font-mono">{expectedAtQuarter.toFixed(1)}</span>
          </span>
          <span className={transition.paceGapPct >= 0 ? "text-primary font-semibold" : "text-destructive font-semibold"}>
            {transition.paceGapPct >= 0 ? '+' : ''}{transition.paceGapPct.toFixed(0)}%
          </span>
        </div>
      </div>
      
      {/* Velocity Comparison */}
      <div className="flex items-center gap-2 text-xs mb-2 flex-wrap">
        <Zap className="w-3 h-3 text-warning" />
        <span className="text-muted-foreground">
          Velocity: <span className="font-mono font-bold text-foreground">{transition.currentVelocity.toFixed(2)}</span>/min
        </span>
        <span className="text-muted-foreground">|</span>
        <span className="text-muted-foreground">
          Need: <span className="font-mono font-bold text-foreground">{transition.neededVelocity.toFixed(2)}</span>/min
        </span>
        {transition.neededVelocity > 0 && (
          <span className={cn(
            "font-bold",
            transition.velocityDelta >= 0 ? "text-primary" : "text-destructive"
          )}>
            ({transition.velocityDelta >= 0 ? '+' : ''}{velocityDeltaPct.toFixed(0)}%)
          </span>
        )}
      </div>
      
      {/* Remaining Stats */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
        <span>
          Remaining: <span className="font-mono font-semibold text-foreground">{transition.requiredRemaining.toFixed(1)}</span>
        </span>
        <span>|</span>
        <span>
          Projected: <span className={cn(
            "font-mono font-semibold",
            transition.projectedFinal >= spot.line ? "text-primary" : "text-destructive"
          )}>
            {transition.projectedFinal.toFixed(1)}
          </span>
        </span>
      </div>
      
      {/* Insight */}
      <p className="text-xs text-muted-foreground mb-2">
        🎯 {transition.insight}
      </p>
      
      {/* Action */}
      <div className={cn(
        "p-2 rounded text-xs font-semibold",
        transition.urgency === 'high' ? "bg-destructive/20 text-destructive" :
        transition.urgency === 'medium' ? "bg-orange-500/20 text-orange-500" :
        "bg-primary/20 text-primary"
      )}>
        {transition.action}
      </div>
    </div>
  );
}
