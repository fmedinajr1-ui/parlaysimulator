import { cn } from "@/lib/utils";
import { ResearchSignal } from "@/types/parlay";
import { 
  Target, TrendingUp, Zap, AlertTriangle, 
  Activity, Users, Flame, DollarSign, BarChart3
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ResearchSignalBadgeProps {
  signal: ResearchSignal;
  compact?: boolean;
}

const engineConfig: Record<string, { 
  icon: React.ElementType; 
  label: string; 
  color: { positive: string; negative: string; neutral: string } 
}> = {
  hitrate: {
    icon: Target,
    label: 'Hit Rate',
    color: {
      positive: 'bg-neon-green/20 text-neon-green border-neon-green/40',
      negative: 'bg-neon-red/20 text-neon-red border-neon-red/40',
      neutral: 'bg-muted/40 text-muted-foreground border-border/40'
    }
  },
  medianlock: {
    icon: Zap,
    label: 'MedianLock',
    color: {
      positive: 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40',
      negative: 'bg-neon-red/20 text-neon-red border-neon-red/40',
      neutral: 'bg-muted/40 text-muted-foreground border-border/40'
    }
  },
  sharp: {
    icon: DollarSign,
    label: 'Sharp Money',
    color: {
      positive: 'bg-neon-purple/20 text-neon-purple border-neon-purple/40',
      negative: 'bg-neon-orange/20 text-neon-orange border-neon-orange/40',
      neutral: 'bg-muted/40 text-muted-foreground border-border/40'
    }
  },
  pvs: {
    icon: BarChart3,
    label: 'PVS',
    color: {
      positive: 'bg-neon-green/20 text-neon-green border-neon-green/40',
      negative: 'bg-neon-red/20 text-neon-red border-neon-red/40',
      neutral: 'bg-muted/40 text-muted-foreground border-border/40'
    }
  },
  fatigue: {
    icon: Activity,
    label: 'Fatigue',
    color: {
      positive: 'bg-neon-green/20 text-neon-green border-neon-green/40',
      negative: 'bg-neon-orange/20 text-neon-orange border-neon-orange/40',
      neutral: 'bg-muted/40 text-muted-foreground border-border/40'
    }
  },
  usage: {
    icon: TrendingUp,
    label: 'Usage',
    color: {
      positive: 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40',
      negative: 'bg-neon-red/20 text-neon-red border-neon-red/40',
      neutral: 'bg-muted/40 text-muted-foreground border-border/40'
    }
  },
  coaching: {
    icon: Users,
    label: 'Coach',
    color: {
      positive: 'bg-neon-green/20 text-neon-green border-neon-green/40',
      negative: 'bg-neon-red/20 text-neon-red border-neon-red/40',
      neutral: 'bg-muted/40 text-muted-foreground border-border/40'
    }
  },
  godmode: {
    icon: Flame,
    label: 'Upset',
    color: {
      positive: 'bg-neon-orange/20 text-neon-orange border-neon-orange/40',
      negative: 'bg-muted/40 text-muted-foreground border-border/40',
      neutral: 'bg-muted/40 text-muted-foreground border-border/40'
    }
  },
  juiced: {
    icon: AlertTriangle,
    label: 'Juice',
    color: {
      positive: 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/40',
      negative: 'bg-neon-red/20 text-neon-red border-neon-red/40',
      neutral: 'bg-muted/40 text-muted-foreground border-border/40'
    }
  }
};

export function ResearchSignalBadge({ signal, compact = false }: ResearchSignalBadgeProps) {
  const config = engineConfig[signal.engine] || engineConfig.hitrate;
  const Icon = config.icon;
  const colorClass = config.color[signal.status];

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium cursor-help",
              colorClass
            )}>
              <Icon className="w-3 h-3" />
              {config.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-sm font-medium">{signal.headline}</p>
            {signal.details && (
              <p className="text-xs text-muted-foreground mt-1">{signal.details}</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={cn(
      "flex items-start gap-2 p-2 rounded-lg border",
      colorClass
    )}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">{signal.headline}</p>
        {signal.details && (
          <p className="text-[10px] opacity-80 mt-0.5">{signal.details}</p>
        )}
      </div>
      {signal.score !== undefined && (
        <span className="text-xs font-bold shrink-0">
          {signal.score > 0 ? '+' : ''}{signal.score.toFixed(0)}
        </span>
      )}
    </div>
  );
}
