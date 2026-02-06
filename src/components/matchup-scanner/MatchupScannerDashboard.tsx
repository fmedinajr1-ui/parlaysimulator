import { useState } from 'react';
import { Zap, TrendingUp, TrendingDown, Users, Minus, Target, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getEasternDate } from '@/lib/dateUtils';
import { usePreGameMatchupScanner } from '@/hooks/usePreGameMatchupScanner';
import { SideFilterBar } from './SideFilterBar';
import { MatchupGradeCard } from './MatchupGradeCard';
import { MatchupScannerAccuracyCard } from './MatchupScannerAccuracyCard';
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
    sideFilter: 'all',
    strengthFilter: 'all',
    propTypeFilter: 'all',
  });
  
  const { analyses, stats, isLoading } = usePreGameMatchupScanner(filters);
  
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
            {todayET} • {stats.totalGames} Games • {stats.totalPlayers} Players
          </p>
        </div>
      </div>
      
      {/* Stats Summary - Stock Ticker Style */}
      {!isLoading && stats.totalPlayers > 0 && (
        <div className="space-y-2">
          {/* Side counts row */}
          <div className="grid grid-cols-4 gap-2">
            <Card className="bg-green-500/10 border-green-500/30">
              <CardContent className="p-2 text-center">
                <div className="text-xs text-green-300 flex items-center justify-center gap-1">
                  <TrendingUp size={10} />
                  OVER
                </div>
                <div className="text-xl font-bold text-green-400">
                  {stats.overCount}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-red-500/10 border-red-500/30">
              <CardContent className="p-2 text-center">
                <div className="text-xs text-red-300 flex items-center justify-center gap-1">
                  <TrendingDown size={10} />
                  UNDER
                </div>
                <div className="text-xl font-bold text-red-400">
                  {stats.underCount}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-muted border-border">
              <CardContent className="p-2 text-center">
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <Minus size={10} />
                  PASS
                </div>
                <div className="text-xl font-bold text-foreground">
                  {stats.passCount}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-muted border-border">
              <CardContent className="p-2 text-center">
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <Users size={10} />
                  Total
                </div>
                <div className="text-xl font-bold text-foreground">
                  {stats.totalPlayers}
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Prop type breakdown row */}
          <div className="grid grid-cols-2 gap-2">
            <Card className="bg-amber-500/10 border-amber-500/30">
              <CardContent className="p-2 flex items-center justify-center gap-2">
                <Target size={14} className="text-amber-400" />
                <span className="text-xs text-amber-300">Points:</span>
                <span className="text-sm font-bold text-amber-400">{stats.pointsEdgeCount}</span>
              </CardContent>
            </Card>
            <Card className="bg-cyan-500/10 border-cyan-500/30">
              <CardContent className="p-2 flex items-center justify-center gap-2">
                <Crosshair size={14} className="text-cyan-400" />
                <span className="text-xs text-cyan-300">3PT:</span>
                <span className="text-sm font-bold text-cyan-400">{stats.threesEdgeCount}</span>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      
      {/* Accuracy Card */}
      <MatchupScannerAccuracyCard />
      
      {/* Filters */}
      {!isLoading && stats.totalPlayers > 0 && (
        <SideFilterBar 
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
              onClick={() => setFilters({ 
                gradeFilter: 'all', 
                boostFilter: 'all', 
                teamFilter: 'all',
                sideFilter: 'all',
                strengthFilter: 'all',
                propTypeFilter: 'all',
              })}
            >
              Clear Filters
            </Button>
          </CardContent>
        </Card>
      )}
      
      {/* Ranked Player List - Stock Ticker Style */}
      {!isLoading && analyses.length > 0 && (
        <div className="space-y-2">
          {analyses.map((analysis) => (
            <MatchupGradeCard
              key={analysis.id}
              analysis={analysis}
              onAddToBuilder={onAddToBuilder}
            />
          ))}
        </div>
      )}
      
      {/* Results Count */}
      {!isLoading && analyses.length > 0 && (
        <p className="text-center text-xs text-muted-foreground pt-2">
          Showing {analyses.length} of {stats.totalPlayers} players • Ranked by edge strength
        </p>
      )}
    </div>
  );
}
