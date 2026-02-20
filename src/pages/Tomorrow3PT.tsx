import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Target, RefreshCw, Plus, Filter, Users, TrendingUp, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTomorrow3PTProps, getTomorrowEasternDate } from "@/hooks/useTomorrow3PTProps";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format, addDays, parse } from "date-fns";

type HitRateFilter = 'all' | '100' | '97' | '90';
type SortOption = 'l10' | 'confidence' | 'edge';

export default function Tomorrow3PT() {
  const navigate = useNavigate();
  const [hitRateFilter, setHitRateFilter] = useState<HitRateFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('l10');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const { picks, isLoading, refetch, analysisDate, stats } = useTomorrow3PTProps();
  const { addLeg } = useParlayBuilder();

  // Parse the analysis date for display
  const displayDate = useMemo(() => {
    try {
      const parsed = parse(analysisDate, 'yyyy-MM-dd', new Date());
      return format(parsed, 'EEEE, MMMM d, yyyy');
    } catch {
      return analysisDate;
    }
  }, [analysisDate]);

  // Filter and sort picks
  const filteredPicks = useMemo(() => {
    let result = [...picks];

    // Apply hit rate filter
    switch (hitRateFilter) {
      case '100':
        result = result.filter(p => p.l10_hit_rate >= 1);
        break;
      case '97':
        result = result.filter(p => p.l10_hit_rate >= 0.97);
        break;
      case '90':
        result = result.filter(p => p.l10_hit_rate >= 0.90);
        break;
    }

    // Apply sort
    switch (sortBy) {
      case 'l10':
        result.sort((a, b) => b.l10_hit_rate - a.l10_hit_rate);
        break;
      case 'confidence':
        result.sort((a, b) => b.confidence_score - a.confidence_score);
        break;
      case 'edge':
        result.sort((a, b) => (b.edge || 0) - (a.edge || 0));
        break;
    }

    return result;
  }, [picks, hitRateFilter, sortBy]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('Refreshed 3PT props');
    } catch (error) {
      toast.error('Failed to refresh');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddToBuilder = (pick: typeof picks[0]) => {
    const line = pick.actual_line ?? pick.recommended_line;
    const description = `${pick.player_name} 3PT OVER ${line}`;
    
    addLeg({
      source: 'sharp',
      description,
      odds: -110,
      playerName: pick.player_name,
      propType: 'player_threes',
      line,
      side: 'over',
      confidenceScore: pick.confidence_score,
    });
    
    toast.success(`Added ${pick.player_name} to parlay`);
  };

  const getHitRateBadge = (hitRate: number) => {
    if (hitRate >= 1) {
      return { label: 'Elite', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
    } else if (hitRate >= 0.97) {
      return { label: 'Near Perfect', className: 'bg-green-500/20 text-green-400 border-green-500/30' };
    } else if (hitRate >= 0.90) {
      return { label: 'Strong', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
    }
    return { label: 'Standard', className: 'bg-muted text-muted-foreground border-border' };
  };

  const getReliabilityBadge = (tier: string | null) => {
    if (!tier) return { label: 'NEW', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
    switch (tier) {
      case 'elite':
        return { label: 'Elite', className: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
      case 'reliable':
        return { label: 'Reliable', className: 'bg-teal-500/20 text-teal-400 border-teal-500/30' };
      case 'neutral':
        return { label: 'Neutral', className: 'bg-muted text-muted-foreground border-border' };
      case 'caution':
        return { label: 'Caution', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' };
      case 'avoid':
        return { label: 'Avoid', className: 'bg-red-500/20 text-red-400 border-red-500/30' };
      default:
        return { label: 'NEW', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
    }
  };

  return (
    <div className="min-h-screen bg-background pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(-1)}
                className="shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-primary" />
                  <h1 className="text-lg font-bold">Tomorrow's 3PT Picks</h1>
                </div>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {displayDate}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn("w-4 h-4 mr-1", isRefreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* Summary Stats */}
        <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
          <CardContent className="p-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-primary">{stats.totalPicks}</p>
                <p className="text-xs text-muted-foreground">Players</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-400">{stats.eliteCount}</p>
                <p className="text-xs text-muted-foreground">100% L10</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stats.uniqueTeams}</p>
                <p className="text-xs text-muted-foreground">Teams</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {(stats.avgHitRate * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">Avg L10</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-1">
            {(['all', '100', '97', '90'] as HitRateFilter[]).map((filter) => (
              <Button
                key={filter}
                variant={hitRateFilter === filter ? "default" : "outline"}
                size="sm"
                onClick={() => setHitRateFilter(filter)}
                className="text-xs"
              >
                {filter === 'all' ? 'All' : `${filter}%+`}
              </Button>
            ))}
          </div>
          <div className="flex gap-1 items-center">
            <Filter className="w-4 h-4 text-muted-foreground" />
            {(['l10', 'confidence', 'edge'] as SortOption[]).map((option) => (
              <Button
                key={option}
                variant={sortBy === option ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSortBy(option)}
                className="text-xs"
              >
                {option === 'l10' ? 'L10' : option === 'confidence' ? 'Conf' : 'Edge'}
              </Button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-6 w-32 mb-2" />
                <Skeleton className="h-4 w-24 mb-3" />
                <Skeleton className="h-10 w-full" />
              </Card>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredPicks.length === 0 && (
          <Card className="p-8 text-center">
            <Target className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-semibold mb-2">No 3PT Picks Available</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {picks.length === 0 
                ? "The Category Analyzer will populate tomorrow's slate when games are scheduled."
                : "No picks match your current filter. Try adjusting the filters above."}
            </p>
            <Button variant="outline" onClick={handleRefresh}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh Props
            </Button>
          </Card>
        )}

        {/* Pick Cards Grid */}
        {!isLoading && filteredPicks.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredPicks.map((pick) => {
              const hitRateBadge = getHitRateBadge(pick.l10_hit_rate);
              const reliabilityBadge = getReliabilityBadge(pick.reliabilityTier);
              const line = pick.actual_line ?? pick.recommended_line;

              return (
                <Card
                  key={pick.id}
                  className="overflow-hidden hover:border-primary/40 transition-colors"
                >
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-semibold text-foreground">{pick.player_name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">
                            {pick.team}
                          </Badge>
                          <Badge variant="outline" className={cn("text-xs", reliabilityBadge.className)}>
                            {reliabilityBadge.label}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge className={cn("text-lg font-bold px-3 py-1", hitRateBadge.className)}>
                          {(pick.l10_hit_rate * 100).toFixed(0)}%
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">L10 Hit Rate</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Line:</span>
                        <span className="font-mono font-semibold text-primary">
                          O {line}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        {pick.l5_avg !== null && (
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">L5</p>
                            <p className="font-semibold">{pick.l5_avg.toFixed(1)}</p>
                          </div>
                        )}
                        {pick.l10_avg !== null && (
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">L10</p>
                            <p className="font-semibold">{pick.l10_avg.toFixed(1)}</p>
                          </div>
                        )}
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground">Conf</p>
                          <p className="font-semibold">{(pick.confidence_score * 100).toFixed(0)}%</p>
                        </div>
                        {pick.edge !== null && (
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Edge</p>
                            <p className={cn(
                              "font-semibold",
                              pick.edge > 0 ? "text-emerald-400" : "text-muted-foreground"
                            )}>
                              {pick.edge > 0 ? '+' : ''}{pick.edge.toFixed(1)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleAddToBuilder(pick)}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add to Builder
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
