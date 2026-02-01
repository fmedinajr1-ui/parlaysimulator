import { Crown, Star, TrendingUp, Minus, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { QualityTier } from "@/types/sweetSpot";

interface QualityTierBadgeProps {
  tier: QualityTier;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const tierConfig: Record<QualityTier, {
  label: string;
  icon: typeof Crown;
  className: string;
}> = {
  ELITE: {
    label: 'ELITE',
    icon: Crown,
    className: 'bg-purple-500/20 text-purple-300 border-purple-500/50',
  },
  PREMIUM: {
    label: 'PREMIUM',
    icon: Star,
    className: 'bg-teal-500/20 text-teal-300 border-teal-500/50',
  },
  STRONG: {
    label: 'STRONG',
    icon: TrendingUp,
    className: 'bg-green-500/20 text-green-300 border-green-500/50',
  },
  STANDARD: {
    label: 'STANDARD',
    icon: Minus,
    className: 'bg-muted text-muted-foreground border-border',
  },
  AVOID: {
    label: 'AVOID',
    icon: AlertTriangle,
    className: 'bg-destructive/20 text-destructive border-destructive/50',
  },
};

const sizeClasses = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs px-2 py-0.5',
  lg: 'text-sm px-2.5 py-1',
};

const iconSizes = {
  sm: 10,
  md: 12,
  lg: 14,
};

export function QualityTierBadge({ tier, showIcon = true, size = 'md' }: QualityTierBadgeProps) {
  const config = tierConfig[tier];
  const Icon = config.icon;
  
  return (
    <Badge 
      variant="outline" 
      className={cn(
        'font-bold gap-1',
        config.className,
        sizeClasses[size]
      )}
    >
      {showIcon && <Icon size={iconSizes[size]} />}
      {config.label}
    </Badge>
  );
}
