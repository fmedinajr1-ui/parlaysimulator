import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PVSTier, PVS_TIER_CONFIG } from "@/types/pvs";

interface PVSTierBadgeProps {
  tier: PVSTier;
  size?: 'sm' | 'md' | 'lg';
  showEmoji?: boolean;
  className?: string;
}

export function PVSTierBadge({ tier, size = 'md', showEmoji = true, className }: PVSTierBadgeProps) {
  const config = PVS_TIER_CONFIG[tier] || PVS_TIER_CONFIG.uncategorized;
  
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-1',
    lg: 'text-sm px-3 py-1.5'
  };

  return (
    <Badge 
      variant="outline"
      className={cn(
        "font-bold border-0",
        config.bgColor,
        config.color,
        sizeClasses[size],
        className
      )}
    >
      {showEmoji && <span className="mr-1">{config.emoji}</span>}
      {config.label}
    </Badge>
  );
}
