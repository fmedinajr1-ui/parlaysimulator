import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HitRateParlayCard } from "./HitRateParlayCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Target, Zap, TrendingUp, TrendingDown, Minus, AlertCircle, Flame, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AddToParlayButton } from "@/components/parlay/AddToParlayButton";

// Calculate trend from game logs (recent games vs older games)
const calculateTrend = (gameLogs: any[], line: number, side: 'over' | 'under'): 'up' | 'down' | 'neutral' => {
  if (!gameLogs || gameLogs.length < 4) return 'neutral';
  
  const recentGames = gameLogs.slice(0, 2);
  const olderGames = gameLogs.slice(2);
  
  if (olderGames.length === 0) return 'neutral';
  
  const recentHits = recentGames.filter((g: any) => 
    side === 'over' ? (g.stat_value || g.value) > line : (g.stat_value || g.value) < line
  ).length / recentGames.length;
  
  const olderHits = olderGames.filter((g: any) => 
    side === 'over' ? (g.stat_value || g.value) > line : (g.stat_value || g.value) < line
  ).length / olderGames.length;
  
  const diff = recentHits - olderHits;
  
  if (diff > 0.15) return 'up';
  if (diff < -0.15) return 'down';
  return 'neutral';
};

const getTrendIcon = (trend: 'up' | 'down' | 'neutral') => {
  switch (trend) {
    case 'up':
      return <TrendingUp className="h-3.5 w-3.5 text-neon-green" />;
    case 'down':
      return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
    default:
      return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

const getTrendLabel = (trend: 'up' | 'down' | 'neutral') => {
  switch (trend) {
    case 'up':
      return 'Hot streak';
    case 'down':
      return 'Cooling off';
    default:
      return 'Stable';
  }
};

// X/5 streak filter options
const STREAK_OPTIONS = [
  { value: "all", label: "All Patterns" },
  { value: "5/5", label: "🔥 5/5 Perfect" },
  { value: "4/5", label: "⚡ 4/5 Strong" },
  { value: "3/5", label: "✓ 3/5 Solid" },
  { value: "2/5", label: "📊 2/5 Trending" },
];

// Sport filter options (NBA first)
const SPORT_OPTIONS = [
  { value: "basketball_nba", label: "🏀 NBA" },
  { value: "all", label: "All Sports" },
  { value: "americanfootball_nfl", label: "🏈 NFL" },
  { value: "icehockey_nhl", label: "🏒 NHL" },
];

const HIT_RATE_OPTIONS = [
  { value: 0.4, label: "40%+" },
  { value: 0.5, label: "50%+" },
  { value: 0.6, label: "60%+" },
  { value: 0.7, label: "70%+" },
  { value: 0.8, label: "80%+" },
];

const getHitRateBadgeClass = (rate: number) => {
  if (rate >= 0.9) return 'bg-neon-green/20 text-neon-green border-neon-green/30';
  if (rate >= 0.8) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  if (rate >= 0.7) return 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30';
  if (rate >= 0.6) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  if (rate >= 0.5) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
  return 'bg-red-500/20 text-red-400 border-red-500/30';
};

const getStreakBadgeClass = (streak: string | null) => {
  if (!streak) return 'bg-muted text-muted-foreground';
  if (streak === '5/5') return 'bg-neon-green/20 text-neon-green border-neon-green/30';
  if (streak === '4/5') return 'bg-neon-purple/20 text-neon-purple border-neon-purple/30';
  if (streak === '3/5') return 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30';
  return 'bg-muted text-muted-foreground';
};

const getStreakEmoji = (streak: string | null, isPerfect: boolean | null) => {
  if (isPerfect || streak === '5/5') return '🔥🔥🔥🔥🔥';
  if (streak === '4/5') return '🔥🔥🔥🔥';
  if (streak === '3/5') return '🔥🔥🔥';
  if (streak === '2/5') return '🔥🔥';
  return '';
};

export function HitRatePicks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [hitRateThreshold, setHitRateThreshold] = useState(0.6);
  const [streakFilter, setStreakFilter] = useState("all");
  const [sportFilter, setSportFilter] = useState("basketball_nba");

  // Fetch existing hit rate parlays
  const { data: parlays, isLoading: parlaysLoading } = useQuery({
    queryKey: ['hitrate-parlays', hitRateThreshold],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hitrate_parlays')
        .select('*')
        .eq('is_active', true)
        .gte('min_hit_rate', hitRateThreshold)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch individual high hit-rate props with filters
  const { data: props, isLoading: propsLoading } = useQuery({
    queryKey: ['hitrate-props', hitRateThreshold, streakFilter, sportFilter],
    queryFn: async () => {
      let query = supabase
        .from('player_prop_hitrates')
        .select('*')
        .or(`hit_rate_over.gte.${hitRateThreshold},hit_rate_under.gte.${hitRateThreshold}`)
        .gt('expires_at', new Date().toISOString())
        .order('confidence_score', { ascending: false })
        .limit(30);
      
      // Apply sport filter
      if (sportFilter !== 'all') {
        query = query.eq('sport', sportFilter);
      }
      
      // Apply streak filter
      if (streakFilter !== 'all') {
        query = query.eq('hit_streak', streakFilter);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data || [];
    }
  });

  // Analyze props mutation
  const analyzeProps = async () => {
    setIsAnalyzing(true);
    try {
      const sports = sportFilter === 'all' 
        ? ['basketball_nba', 'americanfootball_nfl', 'icehockey_nhl']
        : [sportFilter];
        
      const { data, error } = await supabase.functions.invoke('analyze-hitrate-props', {
        body: { 
          sports,
          minHitRate: hitRateThreshold,
          streakFilter: streakFilter !== 'all' ? streakFilter : null,
        }
      });

      if (error) throw error;

      const streakSummary = data.byStreak 
        ? `5/5: ${data.byStreak['5/5']?.length || 0}, 4/5: ${data.byStreak['4/5']?.length || 0}`
        : '';

      toast({
        title: "Analysis Complete",
        description: `Found ${data.analyzed} props. ${streakSummary}`,
      });

      queryClient.invalidateQueries({ queryKey: ['hitrate-props'] });
    } catch (error) {
      console.error('Error analyzing props:', error);
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Build parlays mutation
  const buildParlays = async () => {
    setIsBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke('build-hitrate-parlays', {
        body: { 
          minHitRate: hitRateThreshold,
          maxLegs: 4,
          runSharpAnalysis: true
        }
      });

      if (error) throw error;

      toast({
        title: "Parlays Built",
        description: `Created ${data.parlaysCreated} hit rate parlays`,
      });

      queryClient.invalidateQueries({ queryKey: ['hitrate-parlays'] });
    } catch (error) {
      console.error('Error building parlays:', error);
      toast({
        title: "Build Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsBuilding(false);
    }
  };

  const isLoading = parlaysLoading || propsLoading;

  const formatHitRate = (rate: number) => `${Math.round(rate * 100)}%`;

  const PROP_LABELS: Record<string, string> = {
    'player_points': 'Points',
    'player_rebounds': 'Rebounds',
    'player_assists': 'Assists',
    'player_threes': '3-Pointers',
    'player_points_rebounds_assists': 'PRA',
    'player_pass_tds': 'Pass TDs',
    'player_pass_yds': 'Pass Yards',
    'player_rush_yds': 'Rush Yards',
    'player_goals': 'Goals',
  };

  // Group props by streak for display
  const propsByStreak = {
    '5/5': props?.filter((p: any) => p.hit_streak === '5/5') || [],
    '4/5': props?.filter((p: any) => p.hit_streak === '4/5') || [],
    '3/5': props?.filter((p: any) => p.hit_streak === '3/5') || [],
    other: props?.filter((p: any) => !['5/5', '4/5', '3/5'].includes(p.hit_streak)) || [],
  };

  return (
    <div className="space-y-6">
      {/* Filter Controls */}
      <div className="flex flex-col gap-3">
        {/* Row 1: Sport and Streak Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={sportFilter} onValueChange={setSportFilter}>
            <SelectTrigger className="w-32 bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {SPORT_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={streakFilter} onValueChange={setStreakFilter}>
            <SelectTrigger className="w-36 bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {STREAK_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">Min:</label>
            <Select 
              value={String(hitRateThreshold)} 
              onValueChange={(v) => setHitRateThreshold(Number(v))}
            >
              <SelectTrigger className="w-20 bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {HIT_RATE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 2: Action Buttons */}
        <div className="flex gap-3">
          <Button
            onClick={analyzeProps}
            disabled={isAnalyzing}
            className="flex-1 bg-primary hover:bg-primary/90"
          >
            {isAnalyzing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Target className="h-4 w-4 mr-2" />
            )}
            Scan X/5 Patterns
          </Button>
          <Button
            onClick={buildParlays}
            disabled={isBuilding || !props?.length}
            variant="outline"
            className="flex-1 border-neon-purple/30 text-neon-purple hover:bg-neon-purple/10"
          >
            {isBuilding ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            Build Parlays
          </Button>
        </div>
      </div>

      {/* Streak Summary Badges */}
      {!isLoading && props && props.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {propsByStreak['5/5'].length > 0 && (
            <Badge className="bg-neon-green/20 text-neon-green border-neon-green/30">
              <Flame className="h-3 w-3 mr-1" />
              {propsByStreak['5/5'].length} Perfect (5/5)
            </Badge>
          )}
          {propsByStreak['4/5'].length > 0 && (
            <Badge className="bg-neon-purple/20 text-neon-purple border-neon-purple/30">
              {propsByStreak['4/5'].length} Strong (4/5)
            </Badge>
          )}
          {propsByStreak['3/5'].length > 0 && (
            <Badge className="bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30">
              {propsByStreak['3/5'].length} Solid (3/5)
            </Badge>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Parlays Section */}
      {!isLoading && parlays && parlays.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-neon-green" />
            Hit Rate Parlays
          </h3>
          <div className="grid gap-4">
            {parlays.map((parlay: any) => (
              <HitRateParlayCard 
                key={parlay.id} 
                parlay={parlay}
                onRunSharpAnalysis={async () => {
                  toast({
                    title: "Running Sharp Analysis...",
                    description: "Checking line movements"
                  });
                  await buildParlays();
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Props by Streak Pattern */}
      {!isLoading && props && props.length > 0 && (
        <div className="space-y-6">
          {/* 5/5 Perfect Streaks */}
          {propsByStreak['5/5'].length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Flame className="h-5 w-5 text-neon-green" />
                Perfect 5/5 Streaks
                <Badge className="bg-neon-green/20 text-neon-green text-xs">
                  {propsByStreak['5/5'].length}
                </Badge>
              </h3>
              <div className="grid gap-3">
                {propsByStreak['5/5'].map((prop: any) => (
                  <PropCard key={prop.id} prop={prop} PROP_LABELS={PROP_LABELS} />
                ))}
              </div>
            </div>
          )}

          {/* 4/5 Strong Streaks */}
          {propsByStreak['4/5'].length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Zap className="h-5 w-5 text-neon-purple" />
                Strong 4/5 Patterns
                <Badge className="bg-neon-purple/20 text-neon-purple text-xs">
                  {propsByStreak['4/5'].length}
                </Badge>
              </h3>
              <div className="grid gap-3">
                {propsByStreak['4/5'].map((prop: any) => (
                  <PropCard key={prop.id} prop={prop} PROP_LABELS={PROP_LABELS} />
                ))}
              </div>
            </div>
          )}

          {/* 3/5 and Other */}
          {(propsByStreak['3/5'].length > 0 || propsByStreak.other.length > 0) && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Other Props ({propsByStreak['3/5'].length + propsByStreak.other.length})
              </h3>
              <div className="grid gap-3">
                {[...propsByStreak['3/5'], ...propsByStreak.other].map((prop: any) => (
                  <PropCard key={prop.id} prop={prop} PROP_LABELS={PROP_LABELS} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && (!props || props.length === 0) && (!parlays || parlays.length === 0) && (
        <Card className="bg-card/60 border-border/30">
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold mb-2">No Hit Rate Data Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Click "Scan X/5 Patterns" to analyze NBA player props and find hit streaks
            </p>
            <Button onClick={analyzeProps} disabled={isAnalyzing}>
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Start Scanning
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// PropCard component for rendering individual props with enhanced data
function PropCard({ prop, PROP_LABELS }: { prop: any; PROP_LABELS: Record<string, string> }) {
  const bestHitRate = prop.recommended_side === 'over' 
    ? prop.hit_rate_over 
    : prop.hit_rate_under;
  const hits = prop.recommended_side === 'over' 
    ? prop.over_hits 
    : prop.under_hits;
  const trend = calculateTrend(
    prop.game_logs || [], 
    prop.current_line, 
    prop.recommended_side
  );
  const streakEmoji = getStreakEmoji(prop.hit_streak, prop.is_perfect_streak);
  
  // Get last 5 results for mini visualization
  const last5Results = prop.last_5_results || prop.game_logs?.slice(0, 5) || [];
  
  return (
    <Card className="bg-card/60 border-border/30">
      <CardContent className="py-3 space-y-2">
        {/* Header Row */}
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="font-medium flex items-center gap-2 flex-wrap">
              {prop.player_name}
              {prop.hit_streak && (
                <Badge className={getStreakBadgeClass(prop.hit_streak)}>
                  {prop.hit_streak} {streakEmoji}
                </Badge>
              )}
              <span className="flex items-center gap-1 text-xs">
                {getTrendIcon(trend)}
                <span className={
                  trend === 'up' ? 'text-neon-green' : 
                  trend === 'down' ? 'text-red-400' : 
                  'text-muted-foreground'
                }>
                  {getTrendLabel(trend)}
                </span>
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              {prop.recommended_side.toUpperCase()} {prop.current_line}{' '}
              {PROP_LABELS[prop.prop_type] || prop.prop_type}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {prop.game_description}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <Badge className={getHitRateBadgeClass(bestHitRate)}>
                {hits}/{prop.games_analyzed} ({Math.round(bestHitRate * 100)}%)
              </Badge>
              <div className="text-xs text-muted-foreground mt-1">
                {prop.confidence_score}% confident
              </div>
            </div>
            <AddToParlayButton
              description={`${prop.player_name} ${prop.recommended_side.toUpperCase()} ${prop.current_line} ${PROP_LABELS[prop.prop_type] || prop.prop_type}`}
              odds={prop.recommended_side === 'over' ? (prop.over_price || -110) : (prop.under_price || -110)}
              source="hitrate"
              playerName={prop.player_name}
              propType={prop.prop_type}
              line={prop.current_line}
              side={prop.recommended_side}
              sport={prop.sport}
              eventId={prop.event_id}
              confidenceScore={prop.confidence_score}
              sourceData={{ hitRate: bestHitRate, streak: prop.hit_streak }}
              variant="icon"
            />
          </div>
        </div>
        
        {/* Enhanced Stats Row */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-border/20">
          {/* Last 5 Avg */}
          {prop.last_5_avg !== undefined && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Last 5:</span>
              <span className={prop.last_5_avg > prop.current_line ? 'text-neon-green font-medium' : 'text-red-400 font-medium'}>
                {prop.last_5_avg}
              </span>
            </div>
          )}
          
          {/* VS Opponent */}
          {prop.vs_opponent_games > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">VS Team:</span>
              <span className={prop.vs_opponent_avg > prop.current_line ? 'text-neon-green font-medium' : 'text-amber-400 font-medium'}>
                {prop.vs_opponent_avg?.toFixed(1)} ({prop.vs_opponent_games}g)
              </span>
            </div>
          )}
          
          {/* Projected Value */}
          {prop.projected_value !== undefined && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Proj:</span>
              <span className={prop.projection_margin > 0 ? 'text-neon-green font-medium' : 'text-red-400 font-medium'}>
                {prop.projected_value}
                {prop.projection_margin !== undefined && (
                  <span className="ml-1">
                    ({prop.projection_margin > 0 ? '+' : ''}{prop.projection_margin})
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
        
        {/* Last 5 Games Mini Chart */}
        {last5Results.length > 0 && (
          <div className="flex items-center gap-1 pt-1">
            <span className="text-xs text-muted-foreground mr-1">Games:</span>
            {last5Results.slice(0, 5).map((game: any, idx: number) => {
              const value = game.stat_value || game.value || 0;
              const hitLine = value > prop.current_line;
              return (
                <div
                  key={idx}
                  className={`w-6 h-6 rounded text-[10px] flex items-center justify-center font-medium ${
                    hitLine 
                      ? 'bg-neon-green/20 text-neon-green border border-neon-green/30' 
                      : 'bg-red-500/20 text-red-400 border border-red-500/30'
                  }`}
                  title={`${game.opponent || ''}: ${value}`}
                >
                  {Math.round(value)}
                </div>
              );
            })}
            <span className="text-xs text-muted-foreground ml-1">
              (Line: {prop.current_line})
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
