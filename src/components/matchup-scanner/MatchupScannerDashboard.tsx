import { useState } from 'react';
import { RefreshCw, Target, TrendingUp, Users, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getEasternDate } from '@/lib/dateUtils';
import { usePreGameMatchupScanner } from '@/hooks/usePreGameMatchupScanner';
import { GradeFilterBar } from './GradeFilterBar';
import { GameGroupHeader } from './GameGroupHeader';
import { MatchupGradeCard } from './MatchupGradeCard';
import type { MatchupScannerFilters, PlayerMatchupAnalysis } from '@/types/matchupScanner';

interface MatchupScannerDashboardProps {
  onAddToBuilder?: (analysis: PlayerMatchupAnalysis) => void;
}

export function MatchupScannerDashboard({ onAddToBuilder }: MatchupScannerDashboardProps) {
  const todayET = getEasternDate();
  
  const [filters, setFilters] = useState<MatchupScannerFilters>({
    gradeFilter: 'all',
    boostFilter: 'all',
    teamFilter: 'all',
  });
  
  const { analyses, gameGroups, stats, isLoading } = usePreGameMatchupScanner(filters);
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Zap size={18} className="text-amber-400" />
            Pre-Game Matchup Scanner
          </h2>
          <p className="text-xs text-muted-foreground">
            {todayET} • Zone Analysis vs Opponent Defense
          </p>
        </div>
      </div>
      
      {/* Stats Summary */}
      {!isLoading && stats.totalPlayers > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <Card className="bg-amber-500/10 border-amber-500/30">
            <CardContent className="p-2 text-center">
              <div className="text-xs text-amber-300">A+ Grade</div>
              <div className="text-xl font-bold text-amber-400">
                {stats.gradeDistribution['A+'] || 0}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-green-500/10 border-green-500/30">
            <CardContent className="p-2 text-center">
              <div className="text-xs text-green-300">A Grade</div>
              <div className="text-xl font-bold text-green-400">
                {stats.gradeDistribution['A'] || 0}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-orange-500/10 border-orange-500/30">
            <CardContent className="p-2 text-center">
              <div className="text-xs text-orange-300 flex items-center justify-center gap-1">
                <Target size={10} />
                PTS Boost
              </div>
              <div className="text-xl font-bold text-orange-400">
                {stats.scoringBoostCount}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted border-border">
            <CardContent className="p-2 text-center">
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Users size={10} />
                Players
              </div>
              <div className="text-xl font-bold text-foreground">
                {stats.totalPlayers}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Filters */}
      {!isLoading && stats.totalPlayers > 0 && (
        <GradeFilterBar 
          filters={filters} 
          stats={stats} 
          onFiltersChange={setFilters} 
        />
      )}
      
      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      {/* Empty State */}
      {!isLoading && stats.totalPlayers === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Zap size={32} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground mb-1">
              No pre-game matchups available
            </p>
            <p className="text-xs text-muted-foreground">
              Check back closer to game time for matchup analysis
            </p>
          </CardContent>
        </Card>
      )}
      
      {/* No Results After Filtering */}
      {!isLoading && stats.totalPlayers > 0 && analyses.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground mb-2">
              No players match current filters
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters({ gradeFilter: 'all', boostFilter: 'all', teamFilter: 'all' })}
            >
              Clear Filters
            </Button>
          </CardContent>
        </Card>
      )}
      
      {/* Game Groups */}
      {!isLoading && gameGroups.length > 0 && (
        <div className="space-y-4">
          {gameGroups.map((group) => (
            <div key={group.eventId} className="space-y-2">
              <GameGroupHeader group={group} />
              <div className="grid gap-2 md:grid-cols-2">
                {group.players.map((analysis) => (
                  <MatchupGradeCard
                    key={analysis.id}
                    analysis={analysis}
                    onAddToBuilder={onAddToBuilder}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Results Count */}
      {!isLoading && analyses.length > 0 && (
        <p className="text-center text-xs text-muted-foreground pt-2">
          Showing {analyses.length} of {stats.totalPlayers} players • {stats.totalGames} games
        </p>
      )}
    </div>
  );
}
