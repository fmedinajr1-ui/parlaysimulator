import { Target, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MatchupScannerFilters, MatchupScannerStats, MatchupGradeLetter } from '@/types/matchupScanner';

interface GradeFilterBarProps {
  filters: MatchupScannerFilters;
  stats: MatchupScannerStats;
  onFiltersChange: (filters: MatchupScannerFilters) => void;
}

type GradeFilterOption = MatchupGradeLetter | 'all' | 'A+A' | 'B+B';

const gradeOptions: { value: GradeFilterOption; label: string; color: string }[] = [
  { value: 'all', label: 'All', color: '' },
  { value: 'A+', label: 'A+', color: 'bg-amber-500 hover:bg-amber-600' },
  { value: 'A', label: 'A', color: 'bg-green-500 hover:bg-green-600' },
  { value: 'A+A', label: 'A+/A', color: 'bg-green-600 hover:bg-green-700' },
  { value: 'B+', label: 'B+', color: 'bg-teal-500 hover:bg-teal-600' },
  { value: 'B', label: 'B', color: 'bg-yellow-500 hover:bg-yellow-600' },
];

export function GradeFilterBar({ filters, stats, onFiltersChange }: GradeFilterBarProps) {
  const handleGradeChange = (grade: GradeFilterOption) => {
    onFiltersChange({ ...filters, gradeFilter: grade });
  };
  
  const handleBoostChange = (boost: 'all' | 'scoring' | 'threes') => {
    onFiltersChange({ ...filters, boostFilter: boost });
  };
  
  // Get count for each grade
  const getCount = (grade: GradeFilterOption): number => {
    if (grade === 'all') return stats.totalPlayers;
    if (grade === 'A+A') return (stats.gradeDistribution['A+'] || 0) + (stats.gradeDistribution['A'] || 0);
    if (grade === 'B+B') return (stats.gradeDistribution['B+'] || 0) + (stats.gradeDistribution['B'] || 0);
    return stats.gradeDistribution[grade as MatchupGradeLetter] || 0;
  };
  
  return (
    <div className="space-y-2">
      {/* Grade Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Grade:</span>
        {gradeOptions.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={filters.gradeFilter === option.value ? 'default' : 'outline'}
            onClick={() => handleGradeChange(option.value)}
            className={cn(
              "h-7 px-2 text-xs gap-1",
              filters.gradeFilter === option.value && option.color
            )}
          >
            {option.label}
            <span className="text-[10px] opacity-70">({getCount(option.value)})</span>
          </Button>
        ))}
      </div>
      
      {/* Boost Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Boost:</span>
        <Button
          size="sm"
          variant={filters.boostFilter === 'all' ? 'default' : 'outline'}
          onClick={() => handleBoostChange('all')}
          className="h-7 px-2 text-xs"
        >
          All
        </Button>
        <Button
          size="sm"
          variant={filters.boostFilter === 'scoring' ? 'default' : 'outline'}
          onClick={() => handleBoostChange('scoring')}
          className={cn(
            "h-7 px-2 text-xs gap-1",
            filters.boostFilter === 'scoring' && "bg-orange-600 hover:bg-orange-700"
          )}
        >
          <Target size={12} />
          PTS ({stats.scoringBoostCount})
        </Button>
        <Button
          size="sm"
          variant={filters.boostFilter === 'threes' ? 'default' : 'outline'}
          onClick={() => handleBoostChange('threes')}
          className={cn(
            "h-7 px-2 text-xs gap-1",
            filters.boostFilter === 'threes' && "bg-purple-600 hover:bg-purple-700"
          )}
        >
          <Crosshair size={12} />
          3PT ({stats.threesBoostCount})
        </Button>
      </div>
    </div>
  );
}
