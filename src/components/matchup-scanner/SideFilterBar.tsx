import { TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MatchupScannerFilters, MatchupScannerStats, RecommendedSide, SideStrength } from '@/types/matchupScanner';

interface SideFilterBarProps {
  filters: MatchupScannerFilters;
  stats: MatchupScannerStats;
  onFiltersChange: (filters: MatchupScannerFilters) => void;
}

type SideFilterOption = RecommendedSide | 'all';
type StrengthFilterOption = SideStrength | 'all';

const sideOptions: { value: SideFilterOption; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'all', label: 'All', icon: Zap, color: '' },
  { value: 'over', label: 'OVER', icon: TrendingUp, color: 'bg-green-600 hover:bg-green-700 text-white' },
  { value: 'under', label: 'UNDER', icon: TrendingDown, color: 'bg-red-600 hover:bg-red-700 text-white' },
  { value: 'pass', label: 'PASS', icon: Minus, color: 'bg-muted hover:bg-muted/80' },
];

const strengthOptions: { value: StrengthFilterOption; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'strong', label: '💪 Strong' },
  { value: 'moderate', label: 'Good' },
];

export function SideFilterBar({ filters, stats, onFiltersChange }: SideFilterBarProps) {
  const handleSideChange = (side: SideFilterOption) => {
    onFiltersChange({ ...filters, sideFilter: side });
  };
  
  const handleStrengthChange = (strength: StrengthFilterOption) => {
    onFiltersChange({ ...filters, strengthFilter: strength });
  };
  
  const getCount = (side: SideFilterOption): number => {
    if (side === 'all') return stats.totalPlayers;
    if (side === 'over') return stats.overCount;
    if (side === 'under') return stats.underCount;
    return stats.passCount;
  };
  
  return (
    <div className="space-y-2">
      {/* Side Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Side:</span>
        {sideOptions.map((option) => {
          const Icon = option.icon;
          const isSelected = (filters.sideFilter || 'all') === option.value;
          
          return (
            <Button
              key={option.value}
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              onClick={() => handleSideChange(option.value)}
              className={cn(
                "h-7 px-2 text-xs gap-1",
                isSelected && option.color
              )}
            >
              <Icon size={12} />
              {option.label}
              <span className="text-[10px] opacity-70">({getCount(option.value)})</span>
            </Button>
          );
        })}
      </div>
      
      {/* Strength Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Confidence:</span>
        {strengthOptions.map((option) => {
          const isSelected = (filters.strengthFilter || 'all') === option.value;
          
          return (
            <Button
              key={option.value}
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              onClick={() => handleStrengthChange(option.value)}
              className={cn(
                "h-7 px-2 text-xs",
                isSelected && option.value === 'strong' && "bg-amber-600 hover:bg-amber-700"
              )}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
