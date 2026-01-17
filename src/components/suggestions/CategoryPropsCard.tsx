import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { RefreshCw, Shield, Target, TrendingDown, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { AddToParlayButton } from '@/components/parlay/AddToParlayButton';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
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

const CategoryPickCard = ({ pick }: { pick: CategorySweetSpot }) => {
  const hitRate = pick.l10_hit_rate || 0;
  const isElite = hitRate >= 0.9;
  const description = `${pick.player_name} ${(pick.recommended_side || 'O').toUpperCase()}${pick.recommended_line} ${formatPropType(pick.prop_type)}`;
  
  return (
    <div className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{pick.player_name}</span>
            {isElite && (
              <Badge variant="secondary" className="bg-green-500/20 text-green-600 text-[10px] px-1.5">
                ELITE
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-xs">
              {(pick.recommended_side || 'O').toUpperCase()}{pick.recommended_line} {formatPropType(pick.prop_type)}
            </Badge>
            {pick.confidence_score && (
              <span className="text-xs text-muted-foreground">
                Conf: {pick.confidence_score.toFixed(1)}
              </span>
            )}
          </div>
        </div>
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

  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: allCategoryData, isLoading, refetch } = useQuery({
    queryKey: ['category-sweet-spots-all', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('is_active', true)
        .eq('analysis_date', today)
        .gte('l10_hit_rate', 0.70)
        .order('l10_hit_rate', { ascending: false });

      if (error) throw error;
      return data as CategorySweetSpot[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
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
          L10-validated picks with 70%+ historical hit rates
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
                  <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-1">
                    {categoryPicks.slice(0, 10).map((pick) => (
                      <CategoryPickCard key={pick.id} pick={pick} />
                    ))}
                    {categoryPicks.length > 10 && (
                      <p className="text-xs text-center text-muted-foreground py-2">
                        +{categoryPicks.length - 10} more picks available
                      </p>
                    )}
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
