import { Flame, Minus, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MomentumTier } from "@/types/sweetSpot";

interface MomentumIndicatorProps {
  momentum: MomentumTier;
  ratio: number;
  compact?: boolean;
}

const momentumConfig: Record<MomentumTier, {
  label: string;
  icon: typeof Flame;
  className: string;
  iconClassName: string;
}> = {
  HOT: {
    label: 'HOT',
    icon: Flame,
    className: 'text-orange-400',
    iconClassName: 'text-orange-500',
  },
  NORMAL: {
    label: 'STEADY',
    icon: Minus,
    className: 'text-muted-foreground',
    iconClassName: 'text-muted-foreground',
  },
  COLD: {
    label: 'COLD',
    icon: Snowflake,
    className: 'text-blue-400',
    iconClassName: 'text-blue-500',
  },
};

export function MomentumIndicator({ momentum, ratio, compact = false }: MomentumIndicatorProps) {
  const config = momentumConfig[momentum];
  const Icon = config.icon;
  
  const percentChange = Math.round((ratio - 1) * 100);
  const changeText = percentChange >= 0 ? `+${percentChange}%` : `${percentChange}%`;
  
  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-0.5", config.className)}>
        <Icon size={12} className={config.iconClassName} />
        <span className="text-xs font-medium">{changeText}</span>
      </span>
    );
  }
  
  return (
    <div className="flex items-center gap-2">
      <Icon size={16} className={config.iconClassName} />
      <div className="flex items-center gap-1.5">
        <span className={cn("text-sm font-medium", config.className)}>
          {config.label}
        </span>
        <span className={cn("text-sm font-bold", config.className)}>
          ({changeText})
        </span>
      </div>
    </div>
  );
}
