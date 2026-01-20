import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { RefreshCw, Shield, Target, TrendingDown, TrendingUp, Plus, ChevronDown, ChevronUp, Zap, Lock, Unlock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { AddToParlayButton } from '@/components/parlay/AddToParlayButton';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { useCategoryParlayBuilder } from '@/hooks/useCategoryParlayBuilder';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CategorySweetSpot {
  id: string;
  player_name: string;
  category: string;
  prop_type: string;
  recommended_line: number | null;
  recommended_side: string | null;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  l10_min: number | null;
  l10_max: number | null;
  l10_median: number | null;
  confidence_score: number | null;
  games_played: number | null;
  archetype: string | null;
  analysis_date: string | null;
  is_active: boolean | null;
  risk_level: string | null;
  recommendation: string | null;
}

type CategoryType = 'BIG_REBOUNDER' | 'LOW_LINE_REBOUNDER' | 'NON_SCORING_SHOOTER';

const CATEGORY_CONFIG: Record<CategoryType, { label: string; icon: React.ElementType; color: string; description: string }> = {
  'BIG_REBOUNDER': { 
    label: 'Big Rebounders', 
    icon: Shield, 
    color: 'text-purple-500',
    description: 'High-volume rebounders with 70%+ L10 hit rates'
  },
  'LOW_LINE_REBOUNDER': { 
    label: 'Low Line Rebounders', 
    icon: Target, 
    color: 'text-blue-500',
    description: 'Under-the-radar rebound opportunities'
  },
  'NON_SCORING_SHOOTER': { 
    label: 'Non-Scoring Shooters', 
    icon: TrendingDown, 
    color: 'text-amber-500',
    description: 'Players who consistently stay under points lines'
  },
};

const formatPropType = (propType: string): string => {
  const map: Record<string, string> = {
    'rebounds': 'REB',
    'points': 'PTS',
    'assists': 'AST',
    'threes': '3PM',
    'blocks': 'BLK',
    'steals': 'STL',
  };
  return map[propType] || propType.toUpperCase();
};

const HitRateBar = ({ rate, games }: { rate: number; games: number }) => {
  const percentage = rate * 100;
  const color = percentage >= 90 ? 'bg-green-500' : 
                percentage >= 80 ? 'bg-emerald-500' : 'bg-yellow-500';
  
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all", color)} 
          style={{ width: `${Math.min(percentage, 100)}%` }} 
        />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {percentage.toFixed(0)}% ({games}g)
      </span>
    </div>
  );
};

const L10StatsRow = ({ avg, min, max, median }: { avg: number | null; min: number | null; max: number | null; median: number | null }) => (
  <div className="flex gap-3 text-xs text-muted-foreground">
    <span>Avg: <span className="text-foreground font-medium">{avg?.toFixed(1) || '-'}</span></span>
    <span>Floor: <span className="text-foreground">{min || '-'}</span></span>
    <span>Ceil: <span className="text-foreground">{max || '-'}</span></span>
    <span>Med: <span className="text-foreground">{median?.toFixed(1) || '-'}</span></span>
  </div>
);

const CategoryPickCard = ({ 
  pick, 
  isLocked, 
  onToggleLock 
}: { 
  pick: CategorySweetSpot; 
  isLocked: boolean;
  onToggleLock: () => void;
}) => {
  const hitRate = pick.l10_hit_rate || 0;
  const isElite = hitRate >= 0.9;
  const isUnder = pick.recommended_side === 'under';
  const sidePrefix = isUnder ? 'U' : 'O';
  const description = `${pick.player_name} ${sidePrefix}${pick.recommended_line} ${formatPropType(pick.prop_type)}`;
  
  // Risk level styling
  const getRiskBadgeStyle = (risk: string | null) => {
    switch (risk) {
      case 'LOW': return 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30';
      case 'MEDIUM': return 'bg-amber-500/20 text-amber-600 border-amber-500/30';
      case 'HIGH': return 'bg-orange-500/20 text-orange-600 border-orange-500/30';
      case 'EXTREME': return 'bg-red-500/20 text-red-600 border-red-500/30';
      default: return '';
    }
  };
  
  return (
    <div className={cn(
      "p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors",
      isLocked && "ring-2 ring-primary bg-primary/5"
    )}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{pick.player_name}</span>
            {isElite && (
              <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-600 text-[10px] px-1.5">
                ELITE
              </Badge>
            )}
            {pick.risk_level && pick.risk_level !== 'LOW' && (
              <Badge variant="outline" className={cn("text-[10px] px-1.5", getRiskBadgeStyle(pick.risk_level))}>
                {pick.risk_level}
              </Badge>
            )}
            {isLocked && (
              <Badge variant="secondary" className="bg-primary/20 text-primary text-[10px] px-1.5">
                LOCKED
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge 
              variant="outline" 
              className={cn(
                "text-xs flex items-center gap-1",
                isUnder 
                  ? "bg-destructive/10 border-destructive/30 text-destructive" 
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
              )}
            >
              {isUnder ? (
                <TrendingDown className="h-3 w-3" />
              ) : (
                <TrendingUp className="h-3 w-3" />
              )}
              {sidePrefix}{pick.recommended_line} {formatPropType(pick.prop_type)}
            </Badge>
            {pick.confidence_score && (
              <span className="text-xs text-muted-foreground">
                Conf: {pick.confidence_score.toFixed(1)}
              </span>
            )}
          </div>
          {pick.recommendation && (
            <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-1">
              {pick.recommendation}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={isLocked ? "default" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={onToggleLock}
            title={isLocked ? "Unlock pick" : "Lock pick"}
          >
            {isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          </Button>
          <AddToParlayButton
            description={description}
            odds={-110}
            source="hitrate"
            playerName={pick.player_name}
            propType={pick.prop_type}
            line={pick.recommended_line || undefined}
            side={pick.recommended_side as 'over' | 'under' | undefined}
            sport="basketball_nba"
            confidenceScore={pick.confidence_score || undefined}
            sourceData={{
              l10_hit_rate: pick.l10_hit_rate,
              l10_avg: pick.l10_avg,
              l10_min: pick.l10_min,
              l10_max: pick.l10_max,
              category: pick.category,
              archetype: pick.archetype
            }}
            variant="icon"
          />
        </div>
      </div>
      
      <HitRateBar rate={hitRate} games={pick.games_played || 10} />
      
      <div className="mt-2">
        <L10StatsRow 
          avg={pick.l10_avg} 
          min={pick.l10_min} 
          max={pick.l10_max} 
          median={pick.l10_median} 
        />
      </div>
    </div>
  );
};

const CategoryPickSkeleton = () => (
  <div className="p-3 rounded-lg border bg-card">
    <div className="flex items-start justify-between gap-2 mb-2">
      <div className="flex-1">
        <Skeleton className="h-5 w-32 mb-2" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="h-8 w-8 rounded" />
    </div>
    <Skeleton className="h-2 w-full mb-2" />
    <Skeleton className="h-4 w-48" />
  </div>
);

export const CategoryPropsCard = () => {
  const [selectedCategory, setSelectedCategory] = useState<CategoryType>('BIG_REBOUNDER');
  const [isExpanded, setIsExpanded] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const { addLeg, hasLeg } = useParlayBuilder();
  const { 
    buildCategoryParlay, 
    categoryCounts: todayCategoryCounts, 
    totalAvailable: todayTotalAvailable,
    isLoading: isCategoryParlayLoading,
    lockedPicks,
    toggleLockPick,
    clearLocks,
    isLocked
  } = useCategoryParlayBuilder();

  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: allCategoryData, isLoading, refetch } = useQuery({
    queryKey: ['category-sweet-spots-all', today],
    queryFn: async () => {
      // Step 1: Get players with upcoming games from unified_props
      const { data: upcomingProps } = await supabase
        .from('unified_props')
        .select('player_name')
        .gte('commence_time', new Date().toISOString());
      
      const activePlayers = new Set(
        (upcomingProps || []).map(p => p.player_name?.toLowerCase())
      );
      
      console.log(`[CategoryPropsCard] Found ${activePlayers.size} active players with upcoming games`);
      
      // Step 2: Get category sweet spots for today
      const { data, error } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('is_active', true)
        .eq('analysis_date', today)
        .gte('l10_hit_rate', 0.70)
        .order('l10_hit_rate', { ascending: false });

      if (error) throw error;
      
      // Step 3: Filter to only players with upcoming games
      const filteredData = (data || []).filter(pick => 
        activePlayers.has(pick.player_name?.toLowerCase())
      );
      
      console.log(`[CategoryPropsCard] Filtered from ${data?.length || 0} to ${filteredData.length} picks`);
      
      return filteredData as CategorySweetSpot[];
    },
    staleTime: 60000, // 1 minute for more responsive updates
  });

  const categoryPicks = allCategoryData?.filter(p => p.category === selectedCategory) || [];
  
  const categoryCounts: Record<CategoryType, number> = {
    'BIG_REBOUNDER': allCategoryData?.filter(p => p.category === 'BIG_REBOUNDER').length || 0,
    'LOW_LINE_REBOUNDER': allCategoryData?.filter(p => p.category === 'LOW_LINE_REBOUNDER').length || 0,
    'NON_SCORING_SHOOTER': allCategoryData?.filter(p => p.category === 'NON_SCORING_SHOOTER').length || 0,
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke('category-props-analyzer', {
        body: { forceRefresh: true }
      });
      
      if (error) throw error;
      
      await queryClient.invalidateQueries({ queryKey: ['category-sweet-spots-all'] });
      await refetch();
      toast.success('Category picks refreshed successfully');
    } catch (err) {
      console.error('Refresh failed:', err);
      toast.error('Failed to refresh category picks');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddAllToParlay = () => {
    let addedCount = 0;
    categoryPicks.forEach(pick => {
      const description = `${pick.player_name} ${(pick.recommended_side || 'O').toUpperCase()}${pick.recommended_line} ${formatPropType(pick.prop_type)}`;
      
      if (!hasLeg(description)) {
        addLeg({
          description,
          odds: -110,
          source: 'hitrate',
          playerName: pick.player_name,
          propType: pick.prop_type,
          line: pick.recommended_line || undefined,
          side: pick.recommended_side as 'over' | 'under' | undefined,
          sport: 'basketball_nba',
          confidenceScore: pick.confidence_score || undefined,
          sourceData: {
            l10_hit_rate: pick.l10_hit_rate,
            category: pick.category
          }
        });
        addedCount++;
      }
    });
    
    if (addedCount > 0) {
      toast.success(`Added ${addedCount} picks to parlay`);
    } else {
      toast.info('All picks already in parlay');
    }
  };

  const totalPicks = allCategoryData?.length || 0;
  const config = CATEGORY_CONFIG[selectedCategory];
  const CategoryIcon = config.icon;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Category Sweet Spots
            </CardTitle>
            {totalPicks > 0 && (
              <Badge variant="secondary" className="text-xs">
                {totalPicks} picks
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lockedPicks.size > 0 && (
              <>
                <Badge variant="outline" className="gap-1 text-xs">
                  <Lock className="h-3 w-3" />
                  {lockedPicks.size} locked
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearLocks}
                  className="h-8 text-xs"
                >
                  Clear
                </Button>
              </>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={buildCategoryParlay}
              disabled={isCategoryParlayLoading || todayTotalAvailable === 0}
              className="h-8 text-xs gap-1"
            >
              <Zap className="h-3.5 w-3.5" />
              Build 1+2+1
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-8"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-8 w-8"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          L10-validated picks with 70%+ historical hit rates • Today: {todayCategoryCounts.BIG_REBOUNDER} Big, {todayCategoryCounts.LOW_LINE_REBOUNDER} Low Line, {todayCategoryCounts.NON_SCORING_SHOOTER} Non-Scoring
        </p>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <Tabs value={selectedCategory} onValueChange={(v) => setSelectedCategory(v as CategoryType)}>
            <TabsList className="grid grid-cols-3 mb-4">
              {(Object.keys(CATEGORY_CONFIG) as CategoryType[]).map((cat) => {
                const cfg = CATEGORY_CONFIG[cat];
                const Icon = cfg.icon;
                return (
                  <TabsTrigger key={cat} value={cat} className="text-xs px-2">
                    <Icon className={cn("h-3 w-3 mr-1", cfg.color)} />
                    <span className="hidden sm:inline">{cfg.label.split(' ')[0]}</span>
                    <span className="ml-1">({categoryCounts[cat]})</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {(Object.keys(CATEGORY_CONFIG) as CategoryType[]).map((cat) => (
              <TabsContent key={cat} value={cat} className="mt-0">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground">
                    {CATEGORY_CONFIG[cat].description}
                  </p>
                  {categoryPicks.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddAllToParlay}
                      className="h-7 text-xs"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add All ({categoryPicks.length})
                    </Button>
                  )}
                </div>

                {isLoading ? (
                  <div className="grid gap-2">
                    {[1, 2, 3].map((i) => (
                      <CategoryPickSkeleton key={i} />
                    ))}
                  </div>
                ) : categoryPicks.length > 0 ? (
                  <div className="grid gap-2 max-h-[500px] overflow-y-auto pr-1">
                    {categoryPicks.map((pick) => (
                      <CategoryPickCard 
                        key={pick.id} 
                        pick={pick}
                        isLocked={isLocked(pick.id)}
                        onToggleLock={() => toggleLockPick(pick.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <CategoryIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No {CATEGORY_CONFIG[cat].label.toLowerCase()} found for today</p>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="mt-2"
                    >
                      Refresh to check for picks
                    </Button>
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
};
