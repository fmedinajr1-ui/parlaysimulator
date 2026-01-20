import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { RefreshCw, Flame, Users, Crosshair, Plus, ChevronDown, ChevronUp, Zap, Lock, Unlock, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { AddToParlayButton } from '@/components/parlay/AddToParlayButton';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { useOversParlayBuilder } from '@/hooks/useOversParlayBuilder';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface OversSweetSpot {
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

type OversCategory = 'VOLUME_SCORER' | 'HIGH_ASSIST' | 'THREE_POINT_SHOOTER';

const OVERS_CATEGORY_CONFIG: Record<OversCategory, { label: string; icon: React.ElementType; color: string; description: string }> = {
  'VOLUME_SCORER': { 
    label: 'Scorers', 
    icon: Flame, 
    color: 'text-red-500',
    description: 'High scorers (15+ PPG) hitting Points OVERS at 70%+ L10'
  },
  'HIGH_ASSIST': { 
    label: 'Playmakers', 
    icon: Users, 
    color: 'text-cyan-500',
    description: 'Assist leaders hitting Assists OVERS at 70%+ L10'
  },
  'THREE_POINT_SHOOTER': { 
    label: '3PT Shooters', 
    icon: Crosshair, 
    color: 'text-orange-500',
    description: 'Volume shooters hitting 3PM OVERS at 70%+ L10'
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

const OversPickCard = ({ 
  pick, 
  isLocked, 
  onToggleLock 
}: { 
  pick: OversSweetSpot; 
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
      isLocked && "ring-2 ring-orange-500 bg-orange-500/5"
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
              <Badge variant="secondary" className="bg-orange-500/20 text-orange-500 text-[10px] px-1.5">
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
            className={cn("h-8 w-8", isLocked && "bg-orange-500 hover:bg-orange-600")}
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

const OversPickSkeleton = () => (
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

export const OversPropsCard = () => {
  const [selectedCategory, setSelectedCategory] = useState<OversCategory>('VOLUME_SCORER');
  const [isExpanded, setIsExpanded] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const { addLeg, hasLeg } = useParlayBuilder();
  const { 
    buildOversParlay, 
    categoryCounts: todayCategoryCounts, 
    totalAvailable: todayTotalAvailable,
    isLoading: isOversParlayLoading,
    lockedPicks,
    toggleLockPick,
    clearLocks,
    isLocked
  } = useOversParlayBuilder();

  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: allOversData, isLoading, refetch } = useQuery({
    queryKey: ['overs-sweet-spots-all', today],
    queryFn: async () => {
      // Step 1: Get players with upcoming games from unified_props
      const { data: upcomingProps } = await supabase
        .from('unified_props')
        .select('player_name')
        .gte('commence_time', new Date().toISOString());
      
      const activePlayers = new Set(
        (upcomingProps || []).map(p => p.player_name?.toLowerCase())
      );
      
      console.log(`[OversPropsCard] Found ${activePlayers.size} active players with upcoming games`);
      
      // Step 2: Get OVERS category sweet spots for today
      const { data, error } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('is_active', true)
        .eq('analysis_date', today)
        .in('category', ['VOLUME_SCORER', 'HIGH_ASSIST', 'THREE_POINT_SHOOTER'])
        .gte('l10_hit_rate', 0.70)
        .order('l10_hit_rate', { ascending: false });

      if (error) throw error;
      
      // Step 3: Filter to only players with upcoming games
      const filteredData = (data || []).filter(pick => 
        activePlayers.has(pick.player_name?.toLowerCase())
      );
      
      console.log(`[OversPropsCard] Filtered from ${data?.length || 0} to ${filteredData.length} OVERS picks`);
      
      return filteredData as OversSweetSpot[];
    },
    staleTime: 60000,
  });

  const categoryPicks = allOversData?.filter(p => p.category === selectedCategory) || [];
  
  const categoryCounts: Record<OversCategory, number> = {
    'VOLUME_SCORER': allOversData?.filter(p => p.category === 'VOLUME_SCORER').length || 0,
    'HIGH_ASSIST': allOversData?.filter(p => p.category === 'HIGH_ASSIST').length || 0,
    'THREE_POINT_SHOOTER': allOversData?.filter(p => p.category === 'THREE_POINT_SHOOTER').length || 0,
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke('category-props-analyzer', {
        body: { forceRefresh: true }
      });
      
      if (error) throw error;
      
      await queryClient.invalidateQueries({ queryKey: ['overs-sweet-spots-all'] });
      await refetch();
      toast.success('OVERS picks refreshed successfully');
    } catch (err) {
      console.error('Refresh failed:', err);
      toast.error('Failed to refresh OVERS picks');
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
      toast.success(`Added ${addedCount} OVERS picks to parlay`);
    } else {
      toast.info('All picks already in parlay');
    }
  };

  const totalPicks = allOversData?.length || 0;
  const config = OVERS_CATEGORY_CONFIG[selectedCategory];
  const CategoryIcon = config.icon;

  return (
    <Card className="border-orange-500/30 bg-gradient-to-br from-orange-500/5 to-red-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              L10 OVERS Sweet Spots
            </CardTitle>
            {totalPicks > 0 && (
              <Badge variant="secondary" className="text-xs bg-orange-500/20 text-orange-500">
                {totalPicks} picks
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lockedPicks.size > 0 && (
              <>
                <Badge variant="outline" className="gap-1 text-xs border-orange-500/30 text-orange-500">
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
              onClick={buildOversParlay}
              disabled={isOversParlayLoading || todayTotalAvailable === 0}
              className="h-8 text-xs gap-1 bg-orange-500 hover:bg-orange-600"
            >
              <Zap className="h-3.5 w-3.5" />
              Build OVERS
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
          Points, Assists & 3PM OVERS with 70%+ L10 hit rates • Today: {todayCategoryCounts.VOLUME_SCORER} Scorers, {todayCategoryCounts.HIGH_ASSIST} Playmakers, {todayCategoryCounts.THREE_POINT_SHOOTER} 3PT
        </p>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <Tabs value={selectedCategory} onValueChange={(v) => setSelectedCategory(v as OversCategory)}>
            <TabsList className="grid grid-cols-3 mb-4">
              {(Object.keys(OVERS_CATEGORY_CONFIG) as OversCategory[]).map((cat) => {
                const cfg = OVERS_CATEGORY_CONFIG[cat];
                const Icon = cfg.icon;
                return (
                  <TabsTrigger key={cat} value={cat} className="text-xs px-2">
                    <Icon className={cn("h-3 w-3 mr-1", cfg.color)} />
                    <span className="hidden sm:inline">{cfg.label}</span>
                    <span className="ml-1">({categoryCounts[cat]})</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {(Object.keys(OVERS_CATEGORY_CONFIG) as OversCategory[]).map((cat) => (
              <TabsContent key={cat} value={cat} className="mt-0">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground">
                    {OVERS_CATEGORY_CONFIG[cat].description}
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
                      <OversPickSkeleton key={i} />
                    ))}
                  </div>
                ) : categoryPicks.length > 0 ? (
                  <div className="grid gap-2 max-h-[500px] overflow-y-auto pr-1">
                    {categoryPicks.map((pick) => (
                      <OversPickCard 
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
                    <p className="text-sm">No {OVERS_CATEGORY_CONFIG[cat].label.toLowerCase()} found for today</p>
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