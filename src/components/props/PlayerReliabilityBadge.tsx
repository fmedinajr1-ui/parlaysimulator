import { cn } from "@/lib/utils";
import { Trophy, CheckCircle, Minus, AlertTriangle, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PlayerReliabilityBadgeProps {
  tier: string | null | undefined;
  hitRate?: number | null;
  modifier?: number | null;
  size?: 'sm' | 'md';
  showTooltip?: boolean;
}

const TIER_CONFIG: Record<string, { 
  icon: React.ElementType; 
  label: string; 
  className: string;
  description: string;
}> = {
  elite: { 
    icon: Trophy, 
    label: 'Elite', 
    className: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    description: '65%+ historical hit rate, +1.5 confidence boost'
  },
  reliable: { 
    icon: CheckCircle, 
    label: 'Reliable', 
    className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    description: '50-65% historical hit rate, +0.5 confidence boost'
  },
  neutral: { 
    icon: Minus, 
    label: 'Neutral', 
    className: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    description: '35-50% historical hit rate, no adjustment'
  },
  caution: { 
    icon: AlertTriangle, 
    label: 'Caution', 
    className: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    description: '25-35% historical hit rate, -0.5 confidence penalty'
  },
  avoid: { 
    icon: Ban, 
    label: 'Avoid', 
    className: 'bg-red-500/20 text-red-400 border-red-500/30',
    description: '<25% historical hit rate, -1.5 confidence penalty'
  },
};

export function PlayerReliabilityBadge({ 
  tier, 
  hitRate, 
  modifier,
  size = 'sm',
  showTooltip = true 
}: PlayerReliabilityBadgeProps) {
  if (!tier || tier === 'unknown') return null;
  
  const config = TIER_CONFIG[tier.toLowerCase()];
  if (!config) return null;
  
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  
  const badge = (
    <Badge 
      variant="outline" 
      className={cn(
        config.className, 
        textSize,
        "gap-1 font-medium",
        size === 'sm' ? 'px-1.5 py-0' : 'px-2 py-0.5'
      )}
    >
      <Icon className={iconSize} />
      {hitRate !== null && hitRate !== undefined ? (
        <span>{(hitRate * 100).toFixed(0)}%</span>
      ) : (
        <span>{config.label}</span>
      )}
    </Badge>
  );
  
  if (!showTooltip) return badge;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-semibold">{config.label} Tier</p>
            <p className="text-xs text-muted-foreground">{config.description}</p>
            {hitRate !== null && hitRate !== undefined && (
              <p className="text-xs">Hit Rate: {(hitRate * 100).toFixed(1)}%</p>
            )}
            {modifier !== null && modifier !== undefined && modifier !== 0 && (
              <p className="text-xs">
                Confidence Modifier: {modifier > 0 ? '+' : ''}{modifier.toFixed(1)}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
