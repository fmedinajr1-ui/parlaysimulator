import { useState, useMemo } from "react";
import { ArrowLeft, RefreshCw, Crown, Star, TrendingUp, Filter } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeepSweetSpots } from "@/hooks/useDeepSweetSpots";
import { SweetSpotCard } from "@/components/sweetspots/SweetSpotCard";
import { QualityTierBadge } from "@/components/sweetspots/QualityTierBadge";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { getEasternDate } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import type { PropType, QualityTier, DeepSweetSpot, SweetSpotFilters } from "@/types/sweetSpot";
import { PROP_TYPE_CONFIG } from "@/types/sweetSpot";

type PropFilter = PropType | 'all';
type QualityFilter = 'all' | 'ELITE' | 'PREMIUM+' | 'STRONG+';
type SortOption = 'score' | 'floor' | 'edge' | 'juice';

export default function SweetSpots() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } = useDeepSweetSpots();
  const { addLeg } = useParlayBuilder();
  const todayET = getEasternDate();
  
  const [propFilter, setPropFilter] = useState<PropFilter>('all');
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('score');
  
  const filteredSpots = useMemo(() => {
    if (!data?.spots) return [];
    
    let filtered = [...data.spots];
    
    // Apply prop type filter
    if (propFilter !== 'all') {
      filtered = filtered.filter(s => s.propType === propFilter);
    }
    
    // Apply quality filter
    if (qualityFilter === 'ELITE') {
      filtered = filtered.filter(s => s.qualityTier === 'ELITE');
    } else if (qualityFilter === 'PREMIUM+') {
      filtered = filtered.filter(s => 
        s.qualityTier === 'ELITE' || s.qualityTier === 'PREMIUM'
      );
    } else if (qualityFilter === 'STRONG+') {
      filtered = filtered.filter(s => 
        s.qualityTier === 'ELITE' || s.qualityTier === 'PREMIUM' || s.qualityTier === 'STRONG'
      );
    }
    
    // Apply sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'floor':
          return b.floorProtection - a.floorProtection;
        case 'edge':
          return b.edge - a.edge;
        case 'juice':
          return b.juice.price - a.juice.price;
        case 'score':
        default:
          return b.sweetSpotScore - a.sweetSpotScore;
      }
    });
    
    return filtered;
  }, [data?.spots, propFilter, qualityFilter, sortBy]);
  
  const handleAddToBuilder = (spot: DeepSweetSpot) => {
    const propConfig = PROP_TYPE_CONFIG[spot.propType];
    const description = `${spot.playerName} ${spot.side.toUpperCase()} ${spot.line} ${propConfig.shortLabel}`;
    addLeg({
      description,
      odds: spot.side === 'over' ? spot.overPrice : spot.underPrice,
      source: 'sweet-spots',
      playerName: spot.playerName,
      propType: propConfig.label,
      line: spot.line,
      side: spot.side,
    });
  };
  
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft size={20} />
              </Button>
              <div>
                <h1 className="text-lg font-bold text-foreground">Deep Sweet Spots</h1>
                <p className="text-xs text-muted-foreground">{todayET}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-1.5"
            >
              <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>
      
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* Summary Stats */}
        {data?.stats && (
          <div className="grid grid-cols-4 gap-2">
            <Card className="bg-purple-500/10 border-purple-500/30">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Crown size={14} className="text-purple-400" />
                  <span className="text-xs text-purple-300">ELITE</span>
                </div>
                <div className="text-2xl font-bold text-purple-400">
                  {data.stats.eliteCount}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-teal-500/10 border-teal-500/30">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Star size={14} className="text-teal-400" />
                  <span className="text-xs text-teal-300">PREMIUM</span>
                </div>
                <div className="text-2xl font-bold text-teal-400">
                  {data.stats.premiumCount}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-green-500/10 border-green-500/30">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <TrendingUp size={14} className="text-green-400" />
                  <span className="text-xs text-green-300">STRONG</span>
                </div>
                <div className="text-2xl font-bold text-green-400">
                  {data.stats.strongCount}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-muted border-border">
              <CardContent className="p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">Total</div>
                <div className="text-2xl font-bold text-foreground">
                  {data.stats.totalPicks}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Prop Type Tabs */}
        <Tabs value={propFilter} onValueChange={(v) => setPropFilter(v as PropFilter)}>
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="points">Points</TabsTrigger>
            <TabsTrigger value="assists">Assists</TabsTrigger>
            <TabsTrigger value="threes">3PT</TabsTrigger>
            <TabsTrigger value="blocks">Blocks</TabsTrigger>
          </TabsList>
        </Tabs>
        
        {/* Filters Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Filter size={14} />
            <span>Quality:</span>
          </div>
          <div className="flex gap-1.5">
            {(['all', 'ELITE', 'PREMIUM+', 'STRONG+'] as QualityFilter[]).map((filter) => (
              <Button
                key={filter}
                size="sm"
                variant={qualityFilter === filter ? 'default' : 'outline'}
                onClick={() => setQualityFilter(filter)}
                className="text-xs h-7 px-2"
              >
                {filter === 'all' ? 'All' : filter}
              </Button>
            ))}
          </div>
          
          <div className="flex-1" />
          
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Sort:</span>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="h-7 px-2 text-xs bg-background border border-border rounded-md"
          >
            <option value="score">Score</option>
            <option value="floor">Floor</option>
            <option value="edge">Edge</option>
            <option value="juice">Juice</option>
          </select>
        </div>
        
        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        
        {/* Error State */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="p-4 text-center">
              <p className="text-destructive">Error loading sweet spots</p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => refetch()}
                className="mt-2"
              >
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}
        
        {/* Empty State */}
        {!isLoading && !error && filteredSpots.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground mb-2">
                No sweet spots found for current filters
              </p>
              <p className="text-xs text-muted-foreground">
                Try adjusting your filters or check back when games are available
              </p>
            </CardContent>
          </Card>
        )}
        
        {/* Sweet Spot Cards */}
        <div className="grid gap-3 md:grid-cols-2">
          {filteredSpots.map((spot) => (
            <SweetSpotCard
              key={spot.id}
              spot={spot}
              onAddToBuilder={handleAddToBuilder}
            />
          ))}
        </div>
        
        {/* Results Count */}
        {!isLoading && filteredSpots.length > 0 && (
          <p className="text-center text-xs text-muted-foreground pt-4">
            Showing {filteredSpots.length} of {data?.stats.totalPicks} sweet spots
          </p>
        )}
      </div>
    </div>
  );
}
