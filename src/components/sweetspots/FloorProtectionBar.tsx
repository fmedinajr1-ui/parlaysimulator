import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

interface FloorProtectionBarProps {
  floorProtection: number; // L10 min / line ratio
  l10Min: number;
  line: number;
  compact?: boolean;
}

export function FloorProtectionBar({ 
  floorProtection, 
  l10Min, 
  line,
  compact = false 
}: FloorProtectionBarProps) {
  // Cap at 150% for visual display
  const displayPercentage = Math.min(floorProtection * 100, 150);
  const percentage = Math.round(floorProtection * 100);
  
  // Color based on floor protection level
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
          {percentage}%
        </span>
      </div>
    );
  }
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Floor Protection</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            L10 Min: <span className="text-foreground font-medium">{l10Min}</span>
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
          {percentage}% Coverage
        </span>
        {floorProtection >= 1.0 && (
          <span className="text-xs text-green-400 font-medium">
            ✓ L10 Min Covers Line
          </span>
        )}
      </div>
    </div>
  );
}
