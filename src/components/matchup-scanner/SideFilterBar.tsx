import { TrendingUp, TrendingDown, Minus, Zap, Target, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MatchupScannerFilters, MatchupScannerStats, RecommendedSide, SideStrength, PropEdgeType } from '@/types/matchupScanner';

interface SideFilterBarProps {
  filters: MatchupScannerFilters;
  stats: MatchupScannerStats;
  onFiltersChange: (filters: MatchupScannerFilters) => void;
}

type SideFilterOption = RecommendedSide | 'all';
type StrengthFilterOption = SideStrength | 'all';
type PropTypeFilterOption = 'points' | 'threes' | 'all';

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

const propTypeOptions: { value: PropTypeFilterOption; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'all', label: 'All Props', icon: Zap, color: '' },
  { value: 'points', label: 'Points', icon: Target, color: 'bg-amber-600 hover:bg-amber-700 text-white' },
  { value: 'threes', label: '3PT', icon: Crosshair, color: 'bg-cyan-600 hover:bg-cyan-700 text-white' },
];

export function SideFilterBar({ filters, stats, onFiltersChange }: SideFilterBarProps) {
  const handleSideChange = (side: SideFilterOption) => {
    onFiltersChange({ ...filters, sideFilter: side });
  };
  
  const handleStrengthChange = (strength: StrengthFilterOption) => {
    onFiltersChange({ ...filters, strengthFilter: strength });
  };
  
  const handlePropTypeChange = (propType: PropTypeFilterOption) => {
    onFiltersChange({ ...filters, propTypeFilter: propType as PropEdgeType | 'all' });
  };
  
  const getCount = (side: SideFilterOption): number => {
    if (side === 'all') return stats.totalPlayers;
    if (side === 'over') return stats.overCount;
    if (side === 'under') return stats.underCount;
    return stats.passCount;
  };
  
  const getPropCount = (propType: PropTypeFilterOption): number => {
    if (propType === 'all') return stats.totalPlayers;
    if (propType === 'points') return stats.pointsEdgeCount;
    return stats.threesEdgeCount;
  };
  
  return (
    <div className="space-y-2">
      {/* Side Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground w-12">Side:</span>
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
            </Button>
          );
        })}
      </div>
      
      {/* Prop Type Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground w-12">Prop:</span>
        {propTypeOptions.map((option) => {
          const Icon = option.icon;
          const isSelected = (filters.propTypeFilter || 'all') === option.value;
          
          return (
            <Button
              key={option.value}
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              onClick={() => handlePropTypeChange(option.value)}
              className={cn(
                "h-7 px-2 text-xs gap-1",
                isSelected && option.color
              )}
            >
              <Icon size={12} />
              {option.label}
              <span className="text-[10px] opacity-70">({getPropCount(option.value)})</span>
            </Button>
          );
        })}
      </div>
      
      {/* Strength Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground w-12">Edge:</span>
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
