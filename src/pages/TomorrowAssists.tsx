import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Users, RefreshCw, Plus, Filter, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTomorrowAssistProps } from "@/hooks/useTomorrowAssistProps";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format, parse } from "date-fns";

type HitRateFilter = 'all' | '100' | '90' | '80';
type SortOption = 'l10' | 'confidence' | 'avg';
type CategoryTab = 'all' | 'over' | 'under';

export default function TomorrowAssists() {
  const navigate = useNavigate();
  const [hitRateFilter, setHitRateFilter] = useState<HitRateFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('l10');
  const [activeTab, setActiveTab] = useState<CategoryTab>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const { picks, overPicks, underPicks, isLoading, refetch, analysisDate, stats } = useTomorrowAssistProps();
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

  // Get picks based on active tab
  const tabPicks = useMemo(() => {
    switch (activeTab) {
      case 'over':
        return overPicks;
      case 'under':
        return underPicks;
      default:
        return picks;
    }
  }, [activeTab, picks, overPicks, underPicks]);

  // Filter and sort picks
  const filteredPicks = useMemo(() => {
    let result = [...tabPicks];

    // Apply hit rate filter
    switch (hitRateFilter) {
      case '100':
        result = result.filter(p => p.l10_hit_rate >= 1);
        break;
      case '90':
        result = result.filter(p => p.l10_hit_rate >= 0.90);
        break;
      case '80':
        result = result.filter(p => p.l10_hit_rate >= 0.80);
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
      case 'avg':
        result.sort((a, b) => (b.l10_avg || 0) - (a.l10_avg || 0));
        break;
    }

    return result;
  }, [tabPicks, hitRateFilter, sortBy]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('Refreshed assist props');
    } catch (error) {
      toast.error('Failed to refresh');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddToBuilder = (pick: typeof picks[0]) => {
    const line = pick.actual_line ?? pick.recommended_line;
    const side = pick.category === 'HIGH_ASSIST_UNDER' ? 'under' : 'over';
    const sideLabel = side.toUpperCase();
    const description = `${pick.player_name} AST ${sideLabel} ${line}`;
    
    addLeg({
      source: 'sharp',
      description,
      odds: -110,
      playerName: pick.player_name,
      propType: 'player_assists',
      line,
      side,
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
    } else if (hitRate >= 0.80) {
      return { label: 'Good', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' };
    }
    return { label: 'Standard', className: 'bg-muted text-muted-foreground border-border' };
  };

  const getCategoryBadge = (category: string) => {
    if (category === 'BIG_ASSIST_OVER') {
      return { 
        label: 'Over', 
        icon: TrendingUp,
        className: 'bg-teal-500/20 text-teal-400 border-teal-500/30' 
      };
    }
    return { 
      label: 'Under', 
      icon: TrendingDown,
      className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
    };
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
                  <Users className="w-5 h-5 text-teal-400" />
                  <h1 className="text-lg font-bold">Tomorrow's Assist Plays</h1>
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
        <Card className="bg-gradient-to-br from-teal-500/5 to-amber-500/5 border-teal-500/20">
          <CardContent className="p-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-teal-400">{stats.totalPicks}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-400">{stats.eliteCount}</p>
                <p className="text-xs text-muted-foreground">100% L10</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-teal-400">{stats.overCount}</p>
                <p className="text-xs text-muted-foreground">Over</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-400">{stats.underCount}</p>
                <p className="text-xs text-muted-foreground">Under</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Category Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CategoryTab)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all" className="gap-1">
              All ({stats.totalPicks})
            </TabsTrigger>
            <TabsTrigger value="over" className="gap-1 data-[state=active]:text-teal-400">
              <TrendingUp className="w-3 h-3" />
              Over ({stats.overCount})
            </TabsTrigger>
            <TabsTrigger value="under" className="gap-1 data-[state=active]:text-amber-400">
              <TrendingDown className="w-3 h-3" />
              Under ({stats.underCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-1">
            {(['all', '100', '90', '80'] as HitRateFilter[]).map((filter) => (
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
            {(['l10', 'confidence', 'avg'] as SortOption[]).map((option) => (
              <Button
                key={option}
                variant={sortBy === option ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSortBy(option)}
                className="text-xs"
              >
                {option === 'l10' ? 'L10%' : option === 'confidence' ? 'Conf' : 'Avg'}
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
            <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-semibold mb-2">No Assist Picks Available</h3>
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
              const categoryBadge = getCategoryBadge(pick.category);
              const CategoryIcon = categoryBadge.icon;
              const line = pick.actual_line ?? pick.recommended_line;
              const isUnder = pick.category === 'HIGH_ASSIST_UNDER';

              return (
                <Card
                  key={pick.id}
                  className={cn(
                    "overflow-hidden hover:border-primary/40 transition-colors",
                    isUnder ? "border-amber-500/20" : "border-teal-500/20"
                  )}
                >
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-semibold text-foreground">{pick.player_name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">
                            {pick.team}
                          </Badge>
                          <Badge variant="outline" className={cn("text-xs gap-1", categoryBadge.className)}>
                            <CategoryIcon className="w-3 h-3" />
                            {categoryBadge.label}
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

                    <div className={cn(
                      "flex items-center justify-between rounded-lg p-3 mb-3",
                      isUnder ? "bg-amber-500/10" : "bg-teal-500/10"
                    )}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Line:</span>
                        <span className={cn(
                          "font-mono font-semibold",
                          isUnder ? "text-amber-400" : "text-teal-400"
                        )}>
                          {isUnder ? 'U' : 'O'} {line}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
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
