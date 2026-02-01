import { Check, AlertTriangle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MinutesVerdict } from "@/types/sweetSpot";

interface MinutesVerdictBadgeProps {
  verdict: MinutesVerdict;
  minutesNeeded?: number;
  avgMinutes?: number;
  compact?: boolean;
}

const verdictConfig: Record<MinutesVerdict, {
  label: string;
  icon: typeof Check;
  className: string;
}> = {
  CAN_MEET: {
    label: 'CAN MEET',
    icon: Check,
    className: 'bg-green-500/20 text-green-300 border-green-500/50',
  },
  RISKY: {
    label: 'RISKY',
    icon: AlertTriangle,
    className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50',
  },
  UNLIKELY: {
    label: 'UNLIKELY',
    icon: X,
    className: 'bg-red-500/20 text-red-300 border-red-500/50',
  },
};

export function MinutesVerdictBadge({ 
  verdict, 
  minutesNeeded,
  avgMinutes,
  compact = false 
}: MinutesVerdictBadgeProps) {
  const config = verdictConfig[verdict];
  const Icon = config.icon;
  
  if (compact) {
    return (
      <Badge 
        variant="outline" 
        className={cn('text-[10px] px-1.5 py-0.5 gap-0.5', config.className)}
      >
        <Icon size={10} />
        {config.label}
      </Badge>
    );
  }
  
  return (
    <div className="space-y-1">
      <Badge 
        variant="outline" 
        className={cn('gap-1', config.className)}
      >
        <Icon size={12} />
        {config.label}
      </Badge>
      {minutesNeeded !== undefined && avgMinutes !== undefined && (
        <div className="text-xs text-muted-foreground">
          Needs <span className="font-medium text-foreground">{Math.round(minutesNeeded)}</span> min
          <span className="mx-1">|</span>
          Avg: <span className="font-medium text-foreground">{Math.round(avgMinutes)}</span> min
        </div>
      )}
    </div>
  );
}
