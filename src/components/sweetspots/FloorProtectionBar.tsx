import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import type { PickSide } from "@/types/sweetSpot";

interface FloorProtectionBarProps {
  floorProtection: number; // L10 min / line ratio (OVER) or line / L10 max ratio (UNDER)
  l10Min: number;
  l10Max?: number;
  line: number;
  side: PickSide;
  compact?: boolean;
}

export function FloorProtectionBar({ 
  floorProtection, 
  l10Min, 
  l10Max,
  line,
  side,
  compact = false 
}: FloorProtectionBarProps) {
  const isUnder = side === 'under';
  const rawRatio = floorProtection;
  // Cap at 150% for visual display bar
  const displayPercentage = Math.min(rawRatio * 100, 150);
  // Cap percentage text at 100%
  const percentage = Math.min(Math.round(rawRatio * 100), 100);
  // Show multiplier when floor/ceiling exceeds line
  const floorMultiplier = rawRatio >= 1.0 ? Math.round(rawRatio * 10) / 10 : null;
  
  // Color based on protection level - same logic for both sides (higher = better)
  const getColorClass = () => {
    if (floorProtection >= 1.0) return 'bg-green-500';
    if (floorProtection >= 0.9) return 'bg-yellow-500';
    if (floorProtection >= 0.8) return 'bg-orange-500';
    return 'bg-red-500';
  };
  
  const getTextColorClass = () => {
    if (floorProtection >= 1.0) return 'text-green-400';
    if (floorProtection >= 0.9) return 'text-yellow-400';
    if (floorProtection >= 0.8) return 'text-orange-400';
    return 'text-red-400';
  };
  
  const label = isUnder ? 'Ceiling Protection' : 'Floor Protection';
  const statLabel = isUnder ? 'L10 Max' : 'L10 Min';
  const statValue = isUnder ? (l10Max ?? 0) : l10Min;
  
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div 
            className={cn("h-full transition-all", getColorClass())}
            style={{ width: `${Math.min(displayPercentage, 100)}%` }}
          />
        </div>
        <span className={cn("text-xs font-mono font-bold", getTextColorClass())}>
          {floorMultiplier && floorMultiplier > 1 ? `${floorMultiplier}x` : `${percentage}%`}
        </span>
      </div>
    );
  }
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {statLabel}: <span className="text-foreground font-medium">{statValue}</span>
          </span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">
            Line: <span className="text-foreground font-medium">{line}</span>
          </span>
        </div>
      </div>
      <div className="relative">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className={cn("h-full transition-all duration-500", getColorClass())}
            style={{ width: `${Math.min(displayPercentage, 100)}%` }}
          />
        </div>
        {floorProtection >= 1.0 && (
          <div 
            className="absolute top-0 left-[66.67%] w-0.5 h-2 bg-white/50"
            title="100% line coverage"
          />
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className={cn("text-sm font-bold", getTextColorClass())}>
          {floorMultiplier && floorMultiplier > 1 
            ? `Full Coverage (${floorMultiplier}x)`
            : `${percentage}% Coverage`
          }
        </span>
        {floorProtection >= 1.0 && (
          <span className="text-xs text-green-400 font-medium">
            {isUnder ? '✓ L10 Max Under Line' : '✓ L10 Min Covers Line'}
          </span>
        )}
      </div>
    </div>
  );
}
