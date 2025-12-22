import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Calculator, Target, TrendingUp, TrendingDown, RefreshCw, 
  ChevronDown, ChevronUp, Zap, AlertTriangle, Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';

interface MedianEdgePick {
  id: string;
  player_name: string;
  stat_type: string;
  sportsbook_line: number;
  true_median: number;
  edge: number;
  recommendation: string;
  confidence_flag: string;
  alt_line_suggestion: number | null;
  reason_summary: string;
  m1_recent_form: number;
  m2_matchup: number;
  m3_minutes_weighted: number;
  m4_usage: number;
  m5_location: number;
  adjustments: {
    blowout_risk?: number;
    injury_boost?: number;
    minutes_limit?: number;
  };
  is_volatile: boolean;
  std_dev: number;
  outcome: string;
  team_name?: string;
  opponent_team?: string;
}

const statEmojis: Record<string, string> = {
  'points': '🏀',
  'rebounds': '📊',
  'assists': '🎯',
};

export function MedianEdgePicksCard() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedPick, setExpandedPick] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: picks, isLoading, refetch } = useQuery({
    queryKey: ['median-edge-picks'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('median_edge_picks')
        .select('*')
        .eq('game_date', today)
        .in('recommendation', ['STRONG OVER', 'STRONG UNDER', 'LEAN OVER', 'LEAN UNDER'])
        .order('edge', { ascending: false });
      
      if (error) throw error;
      
      return (data || []).map(pick => ({
        ...pick,
        adjustments: (pick.adjustments as MedianEdgePick['adjustments']) || {},
      })) as MedianEdgePick[];
    },
    staleTime: 1000 * 60 * 5,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke('median-edge-engine', {
        body: { action: 'get_picks' }
      });
      
      if (error) throw error;
      await refetch();
      toast({
        title: "Picks Refreshed",
        description: "Latest median edge analysis loaded.",
      });
    } catch (error) {
      toast({
        title: "Refresh Failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const getRecommendationStyle = (rec: string) => {
    if (rec.includes('STRONG OVER')) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (rec.includes('STRONG UNDER')) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (rec.includes('LEAN OVER')) return 'bg-green-500/10 text-green-300 border-green-500/20';
    if (rec.includes('LEAN UNDER')) return 'bg-red-500/10 text-red-300 border-red-500/20';
    return 'bg-muted text-muted-foreground';
  };

  const strongPicks = picks?.filter(p => p.recommendation.includes('STRONG')) || [];
  const leanPicks = picks?.filter(p => p.recommendation.includes('LEAN')) || [];

  if (isLoading) {
    return (
      <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-cyan-500/10">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!picks || picks.length === 0) {
    return (
      <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-cyan-500/10">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calculator className="w-5 h-5 text-cyan-500" />
            5-Median Edge Engine
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-6">
          <p className="text-muted-foreground mb-4">No edge picks available yet for today</p>
          <Button onClick={handleRefresh} disabled={isRefreshing} size="sm" variant="outline">
            {isRefreshing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Check for Picks
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 via-background to-cyan-500/10 overflow-hidden">
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calculator className="w-5 h-5 text-cyan-500" />
            5-Median Edge Engine
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-7 w-7 hover:bg-cyan-500/10"
            >
              <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
            </Button>
            <Badge variant="outline" className="text-xs">
              {picks.length} picks
            </Badge>
          </div>
        </div>
        
        {/* Summary Stats */}
        <div className="flex items-center gap-4 mt-2 text-sm">
          <div className="flex items-center gap-1">
            <Target className="w-4 h-4 text-green-500" />
            <span className="text-muted-foreground">Strong:</span>
            <span className="font-semibold text-green-500">{strongPicks.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-4 h-4 text-yellow-500" />
            <span className="text-muted-foreground">Lean:</span>
            <span className="font-semibold text-yellow-500">{leanPicks.length}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-3">
        {/* Strong Picks */}
        {strongPicks.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Strong Plays (+3 Edge)</h4>
            {strongPicks.map((pick) => (
              <PickCard 
                key={pick.id} 
                pick={pick} 
                isExpanded={expandedPick === pick.id}
                onToggle={() => setExpandedPick(expandedPick === pick.id ? null : pick.id)}
                getRecommendationStyle={getRecommendationStyle}
              />
            ))}
          </div>
        )}

        {/* Lean Picks */}
        {leanPicks.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lean Plays (+1.5 Edge)</h4>
            {leanPicks.slice(0, 3).map((pick) => (
              <PickCard 
                key={pick.id} 
                pick={pick} 
                isExpanded={expandedPick === pick.id}
                onToggle={() => setExpandedPick(expandedPick === pick.id ? null : pick.id)}
                getRecommendationStyle={getRecommendationStyle}
              />
            ))}
          </div>
        )}

        {/* Engine Info */}
        <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
          <Info className="w-3 h-3" />
          <span>Weighted medians: Form 25% • Matchup 20% • Minutes 20% • Usage 20% • Location 15%</span>
        </div>
      </CardContent>
    </Card>
  );
}

function PickCard({ 
  pick, 
  isExpanded, 
  onToggle,
  getRecommendationStyle 
}: { 
  pick: MedianEdgePick;
  isExpanded: boolean;
  onToggle: () => void;
  getRecommendationStyle: (rec: string) => string;
}) {
  const isOver = pick.recommendation.includes('OVER');
  const statEmoji = statEmojis[pick.stat_type] || '📊';

  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{statEmoji}</span>
            <span className="font-medium text-sm truncate">{pick.player_name}</span>
            {pick.confidence_flag === 'JUICE_LAG_SHARP' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                <Zap className="w-2.5 h-2.5 mr-0.5" />
                SHARP
              </Badge>
            )}
            {pick.is_volatile && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-orange-500/20 text-orange-400 border-orange-500/30">
                <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                VOL
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {pick.stat_type.charAt(0).toUpperCase() + pick.stat_type.slice(1)} {pick.sportsbook_line}
          </p>
          {pick.team_name && (
            <p className="text-xs text-muted-foreground/70">
              {pick.team_name} {pick.opponent_team ? `vs ${pick.opponent_team}` : ''}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <Badge variant="outline" className={cn("text-xs mb-1", getRecommendationStyle(pick.recommendation))}>
            {isOver ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
            {pick.recommendation}
          </Badge>
          <div className={cn(
            "text-sm font-semibold",
            pick.edge >= 3 ? "text-green-500" : 
            pick.edge >= 1.5 ? "text-yellow-500" : "text-muted-foreground"
          )}>
            {pick.edge > 0 ? '+' : ''}{pick.edge.toFixed(1)} edge
          </div>
        </div>
      </div>

      {/* Collapsible Details */}
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full mt-2 h-6 text-xs text-muted-foreground">
            {isExpanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
            {isExpanded ? 'Hide Details' : 'Show 5-Median Breakdown'}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {/* True Median vs Line */}
          <div className="flex items-center justify-between p-2 rounded bg-background/50">
            <span className="text-xs text-muted-foreground">True Median</span>
            <span className="font-semibold text-cyan-400">{pick.true_median.toFixed(1)}</span>
          </div>

          {/* 5 Medians */}
          <div className="grid grid-cols-5 gap-1 text-center">
            <div className="p-1.5 rounded bg-background/30">
              <div className="text-[10px] text-muted-foreground">Form</div>
              <div className="text-xs font-medium">{pick.m1_recent_form?.toFixed(1) || '-'}</div>
            </div>
            <div className="p-1.5 rounded bg-background/30">
              <div className="text-[10px] text-muted-foreground">Match</div>
              <div className="text-xs font-medium">{pick.m2_matchup?.toFixed(1) || '-'}</div>
            </div>
            <div className="p-1.5 rounded bg-background/30">
              <div className="text-[10px] text-muted-foreground">Mins</div>
              <div className="text-xs font-medium">{pick.m3_minutes_weighted?.toFixed(1) || '-'}</div>
            </div>
            <div className="p-1.5 rounded bg-background/30">
              <div className="text-[10px] text-muted-foreground">Usage</div>
              <div className="text-xs font-medium">{pick.m4_usage?.toFixed(1) || '-'}</div>
            </div>
            <div className="p-1.5 rounded bg-background/30">
              <div className="text-[10px] text-muted-foreground">Loc</div>
              <div className="text-xs font-medium">{pick.m5_location?.toFixed(1) || '-'}</div>
            </div>
          </div>

          {/* Adjustments */}
          {(pick.adjustments?.blowout_risk || pick.adjustments?.injury_boost || pick.adjustments?.minutes_limit) && (
            <div className="flex flex-wrap gap-1">
              {pick.adjustments?.blowout_risk && (
                <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400">
                  Blowout {pick.adjustments.blowout_risk}
                </Badge>
              )}
              {pick.adjustments?.injury_boost && (
                <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400">
                  Injury Boost +{pick.adjustments.injury_boost}
                </Badge>
              )}
              {pick.adjustments?.minutes_limit && (
                <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-400">
                  Mins Limit {pick.adjustments.minutes_limit}
                </Badge>
              )}
            </div>
          )}

          {/* Reason */}
          <p className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
            {pick.reason_summary}
          </p>

          {/* Alt Line Suggestion */}
          {pick.alt_line_suggestion && (
            <div className="flex items-center gap-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
              <AlertTriangle className="w-3 h-3 text-yellow-500" />
              <span className="text-xs text-yellow-400">
                Alt line suggestion: {pick.alt_line_suggestion.toFixed(1)}
              </span>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
