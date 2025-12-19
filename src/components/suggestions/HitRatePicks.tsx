import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HitRateParlayCard } from "./HitRateParlayCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Target, Zap, TrendingUp, TrendingDown, Minus, AlertCircle, Flame, Plus, BarChart3, Shield, Thermometer, Snowflake, Swords } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AddToParlayButton } from "@/components/parlay/AddToParlayButton";
import { MiniEnsembleScore } from "@/components/bestbets/MiniEnsembleScore";
import { MiniKellyIndicator } from "@/components/bestbets/MiniKellyIndicator";
import { extractHitRateSignals } from "@/lib/ensemble-engine";
import { OpponentImpactCard } from "@/components/results/OpponentImpactCard";
import { cn } from "@/lib/utils";

// Calculate opponent impact based on hit rate differential
const calculateOpponentImpact = (
  overallHitRate: number, 
  vsOpponentHitRate: number | null
): 'BOOST' | 'NEUTRAL' | 'CAUTION' | 'FADE' => {
  if (!vsOpponentHitRate) return 'NEUTRAL';
  
  const diff = vsOpponentHitRate - overallHitRate;
  
  if (diff >= 0.1) return 'BOOST';      // 10%+ better vs opponent
  if (diff <= -0.2) return 'FADE';       // 20%+ worse vs opponent
  if (diff <= -0.1) return 'CAUTION';    // 10%+ worse vs opponent
  return 'NEUTRAL';
};

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

// X/5 streak filter options - Only 5/5 and 8/10
const STREAK_OPTIONS = [
  { value: "all", label: "All (80%+)" },
  { value: "5/5", label: "🔥 5/5 Perfect" },
];

// Sport filter - Always scans all 3, but can filter display
const SPORT_OPTIONS = [
  { value: "all", label: "All Sports" },
  { value: "basketball_nba", label: "🏀 NBA" },
  { value: "americanfootball_nfl", label: "🏈 NFL" },
  { value: "icehockey_nhl", label: "🏒 NHL" },
];

// Only 80%+ hit rates
const HIT_RATE_OPTIONS = [
  { value: 0.8, label: "80%+ (8/10)" },
  { value: 1.0, label: "100% (5/5)" },
];

// Line value filter options
const LINE_VALUE_OPTIONS = [
  { value: "all", label: "All Lines" },
  { value: "excellent", label: "💎 Excellent Value" },
  { value: "good", label: "✨ Good Value" },
  { value: "consistent", label: "📊 Consistent Players" },
  { value: "hot", label: "🔥 Trending Up" },
];

// Opponent matchup filter options
const OPPONENT_MATCHUP_OPTIONS = [
  { value: "all", label: "All Matchups" },
  { value: "boost", label: "🚀 Favorable" },
  { value: "fade", label: "🚫 Avoid (FADE)" },
];

// Get line value badge styling
const getLineValueBadgeClass = (label: string | null) => {
  switch (label) {
    case 'excellent':
      return 'bg-neon-green/20 text-neon-green border-neon-green/30';
    case 'good':
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'poor':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    default:
      return 'bg-muted/30 text-muted-foreground border-border/30';
  }
};

// Get consistency badge styling  
const getConsistencyBadgeClass = (score: number) => {
  if (score >= 70) return 'bg-neon-green/20 text-neon-green border-neon-green/30';
  if (score >= 50) return 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30';
  return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
};

// Get season trend styling
const getSeasonTrendBadge = (trend: string | null, pct: number | null) => {
  if (trend === 'hot') return { class: 'bg-neon-green/20 text-neon-green', icon: TrendingUp, label: 'Hot' };
  if (trend === 'cold') return { class: 'bg-red-500/20 text-red-400', icon: TrendingDown, label: 'Cold' };
  return { class: 'bg-muted/30 text-muted-foreground', icon: Minus, label: 'Stable' };
};

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
  const [isCalcStats, setIsCalcStats] = useState(false);
  const [isNhlFetching, setIsNhlFetching] = useState(false);
  const [hitRateThreshold, setHitRateThreshold] = useState(0.8); // Default to 80%
  const [streakFilter, setStreakFilter] = useState("all");
  const [sportFilter, setSportFilter] = useState("all"); // Default to all sports
  const [lineValueFilter, setLineValueFilter] = useState("all");
  const [opponentMatchupFilter, setOpponentMatchupFilter] = useState("all");
  const [propsToday, setPropsToday] = useState(0);
  const hasAutoFetched = useRef(false);

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
    queryKey: ['hitrate-props', hitRateThreshold, streakFilter, sportFilter, lineValueFilter, opponentMatchupFilter],
    queryFn: async () => {
      let query = supabase
        .from('player_prop_hitrates')
        .select('*')
        .or(`hit_rate_over.gte.${hitRateThreshold},hit_rate_under.gte.${hitRateThreshold}`)
        .gt('expires_at', new Date().toISOString())
        .order('confidence_score', { ascending: false })
        .limit(50);
      
      // Apply sport filter
      if (sportFilter !== 'all') {
        query = query.eq('sport', sportFilter);
      }
      
      // Apply streak filter
      if (streakFilter !== 'all') {
        query = query.eq('hit_streak', streakFilter);
      }
      
      // Apply line value filter
      if (lineValueFilter === 'excellent') {
        query = query.eq('line_value_label', 'excellent');
      } else if (lineValueFilter === 'good') {
        query = query.or('line_value_label.eq.excellent,line_value_label.eq.good');
      } else if (lineValueFilter === 'consistent') {
        query = query.gte('consistency_score', 65);
      } else if (lineValueFilter === 'hot') {
        query = query.eq('trend_direction', 'hot');
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      // Apply opponent matchup filter client-side (after fetching)
      let filteredData = data || [];
      if (opponentMatchupFilter !== 'all') {
        filteredData = filteredData.filter((prop: any) => {
          if (!prop.vs_opponent_games || prop.vs_opponent_games < 2) return false;
          const bestHitRate = prop.recommended_side === 'over' ? prop.hit_rate_over : prop.hit_rate_under;
          const impact = calculateOpponentImpact(bestHitRate, prop.vs_opponent_hit_rate);
          if (opponentMatchupFilter === 'boost') return impact === 'BOOST';
          if (opponentMatchupFilter === 'fade') return impact === 'FADE' || impact === 'CAUTION';
          return true;
        });
      }
      
      return filteredData;
    }
  });

  // Auto-fetch props when component mounts if none exist
  useEffect(() => {
    if (!propsLoading && (!props || props.length === 0) && !hasAutoFetched.current && !isAnalyzing) {
      hasAutoFetched.current = true;
      analyzeProps();
    }
  }, [propsLoading, props]);

  // Calculate season stats
  const calculateSeasonStats = async () => {
    setIsCalcStats(true);
    try {
      const { data, error } = await supabase.functions.invoke('calculate-season-stats');
      if (error) throw error;
      
      toast({
        title: "Season Stats Updated",
        description: `Processed ${data.playersUpdated} players`,
      });
    } catch (error) {
      console.error('Error calculating season stats:', error);
      toast({
        title: "Stats Calculation Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsCalcStats(false);
    }
  };

  // Fetch NHL stats
  const fetchNhlStats = async () => {
    setIsNhlFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke('nhl-stats-fetcher', {
        body: { daysBack: 14 }
      });
      if (error) throw error;
      
      toast({
        title: "NHL Stats Updated",
        description: data.message || `Fetched ${data.playersInserted} player logs`,
      });
    } catch (error) {
      console.error('Error fetching NHL stats:', error);
      toast({
        title: "NHL Stats Fetch Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsNhlFetching(false);
    }
  };

  // Analyze props mutation - always scans all 3 sports with strict filtering
  const analyzeProps = async () => {
    setIsAnalyzing(true);
    try {
      // Always scan all 3 sports (backend ignores sports param anyway)
      const { data, error } = await supabase.functions.invoke('analyze-hitrate-props', {
        body: { 
          limit: 100,
          minHitRate: 0.8, // Force 80% minimum
          streakFilter: streakFilter !== 'all' ? streakFilter : null,
        }
      });

      if (error) throw error;

      // Update daily props count
      if (data.propsToday !== undefined) {
        setPropsToday(data.propsToday);
      }

      // Handle daily limit reached
      if (data.dailyLimitReached) {
        toast({
          title: "Daily Limit Reached",
          description: `${data.propsToday}/100 props scanned today. Try again tomorrow.`,
        });
      } else if (data.noPropsReason) {
        toast({
          title: "No Props Available",
          description: data.noPropsReason,
        });
      } else {
        const streakSummary = data.byStreak 
          ? `🔥 5/5: ${data.byStreak['5/5']?.length || 0}`
          : '';

        toast({
          title: "Analysis Complete",
          description: data.analyzed > 0 
            ? `Found ${data.analyzed} props (${data.propsToday}/100 today). ${streakSummary}`
            : `Checked ${data.propsChecked} props but none met 80%+ threshold`,
        });
      }

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

  // Dismiss parlay
  const dismissParlay = async (parlayId: string) => {
    try {
      const { error } = await supabase
        .from('hitrate_parlays')
        .update({ is_active: false })
        .eq('id', parlayId);
      
      if (error) throw error;
      
      toast({
        title: "Parlay Dismissed",
        description: "Parlay has been removed from your feed"
      });
      
      queryClient.invalidateQueries({ queryKey: ['hitrate-parlays'] });
    } catch (error) {
      console.error('Error dismissing parlay:', error);
      toast({
        title: "Error",
        description: "Failed to dismiss parlay",
        variant: "destructive"
      });
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

  // Calculate opponent matchup stats for summary badges
  const opponentMatchupStats = useMemo(() => {
    if (!props) return { boost: 0, fade: 0, caution: 0 };
    
    let boost = 0, fade = 0, caution = 0;
    props.forEach((prop: any) => {
      if (prop.vs_opponent_games >= 2) {
        const bestHitRate = prop.recommended_side === 'over' ? prop.hit_rate_over : prop.hit_rate_under;
        const impact = calculateOpponentImpact(bestHitRate, prop.vs_opponent_hit_rate);
        if (impact === 'BOOST') boost++;
        else if (impact === 'FADE') fade++;
        else if (impact === 'CAUTION') caution++;
      }
    });
    return { boost, fade, caution };
  }, [props]);

  return (
    <div className="space-y-6">
      {/* Filter Controls */}
      <div className="flex flex-col gap-3">
        {/* Row 1: Sport, Streak, and Line Value Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={sportFilter} onValueChange={setSportFilter}>
            <SelectTrigger className="w-28 bg-background border-border">
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
            <SelectTrigger className="w-32 bg-background border-border">
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

          <Select value={lineValueFilter} onValueChange={setLineValueFilter}>
            <SelectTrigger className="w-40 bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {LINE_VALUE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={opponentMatchupFilter} onValueChange={setOpponentMatchupFilter}>
            <SelectTrigger className="w-36 bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {OPPONENT_MATCHUP_OPTIONS.map(opt => (
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
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={calculateSeasonStats}
            disabled={isCalcStats}
            variant="outline"
            size="sm"
            className="border-neon-yellow/30 text-neon-yellow hover:bg-neon-yellow/10"
          >
            {isCalcStats ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <BarChart3 className="h-4 w-4 mr-2" />
            )}
            NBA Stats
          </Button>
          <Button
            onClick={fetchNhlStats}
            disabled={isNhlFetching}
            variant="outline"
            size="sm"
            className="border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10"
          >
            {isNhlFetching ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Snowflake className="h-4 w-4 mr-2" />
            )}
            NHL Stats
          </Button>
          {/* Daily Props Counter */}
          <Badge variant="outline" className="border-neon-purple/50 text-neon-purple px-3 py-1.5">
            {propsToday}/100 today
          </Badge>
          
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
          
          {/* Opponent Matchup Summary Badges */}
          {opponentMatchupStats.boost > 0 && (
            <Badge className="bg-neon-green/20 text-neon-green border-neon-green/30">
              <Swords className="h-3 w-3 mr-1" />
              🚀 {opponentMatchupStats.boost} Favorable Matchups
            </Badge>
          )}
          {opponentMatchupStats.fade > 0 && (
            <Badge className="bg-neon-red/20 text-neon-red border-neon-red/30">
              🚫 {opponentMatchupStats.fade} Matchups to Avoid
            </Badge>
          )}
          {opponentMatchupStats.caution > 0 && (
            <Badge className="bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30">
              ⚠️ {opponentMatchupStats.caution} Mixed History
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
                onDismiss={dismissParlay}
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

// PropCard component for rendering individual props with enhanced season data
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
  
  // Season trend badge data
  const seasonTrendData = getSeasonTrendBadge(prop.trend_direction, prop.season_trend_pct);
  const SeasonTrendIcon = seasonTrendData.icon;
  
  // Calculate opponent impact
  const opponentImpact = calculateOpponentImpact(bestHitRate, prop.vs_opponent_hit_rate);
  const hasOpponentData = prop.vs_opponent_games >= 2;
  
  // Calculate blended metrics
  const overallMedian = prop.last_5_avg || prop.season_avg || prop.current_line;
  const vsOpponentMedian = prop.vs_opponent_avg || overallMedian;
  const blendedHitRate = hasOpponentData 
    ? (bestHitRate * 0.6) + ((prop.vs_opponent_hit_rate || bestHitRate) * 0.4)
    : bestHitRate;
  const blendedMedian = hasOpponentData
    ? (overallMedian * 0.6) + (vsOpponentMedian * 0.4)
    : overallMedian;
  
  // Generate ensemble signals
  const ensembleSignals = useMemo(() => extractHitRateSignals({
    hit_rate_over: prop.hit_rate_over,
    hit_rate_under: prop.hit_rate_under,
    recommended_side: prop.recommended_side,
    consistency_score: prop.consistency_score,
    line_value_label: prop.line_value_label,
    trend_direction: prop.trend_direction,
    confidence_score: prop.confidence_score,
    season_avg: prop.season_avg,
    current_line: prop.current_line
  }), [prop]);
  
  // Get odds for Kelly calculation
  const propOdds = prop.recommended_side === 'over' 
    ? (prop.over_price || -110) 
    : (prop.under_price || -110);
  
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
              {/* Line Value Badge */}
              {prop.line_value_label && prop.line_value_label !== 'neutral' && (
                <Badge className={getLineValueBadgeClass(prop.line_value_label)}>
                  {prop.line_value_label === 'excellent' && '💎'}
                  {prop.line_value_label === 'good' && '✨'}
                  {prop.line_value_label === 'poor' && '⚠️'}
                  {prop.line_vs_season_pct > 0 ? '+' : ''}{prop.line_vs_season_pct}%
                </Badge>
              )}
              {/* Opponent Impact Badge (Prominent in Header) */}
              {hasOpponentData && opponentImpact !== 'NEUTRAL' && (
                <Badge className={cn(
                  opponentImpact === 'BOOST' && "bg-neon-green/20 text-neon-green border-neon-green/30",
                  opponentImpact === 'CAUTION' && "bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30",
                  opponentImpact === 'FADE' && "bg-neon-red/20 text-neon-red border-neon-red/30 animate-pulse"
                )}>
                  {opponentImpact === 'BOOST' && '🚀'}
                  {opponentImpact === 'CAUTION' && '⚠️'}
                  {opponentImpact === 'FADE' && '🚫'}
                  vs {prop.opponent_name?.split(' ').pop() || 'OPP'}
                </Badge>
              )}
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
              odds={propOdds}
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
        
        {/* Ensemble & Kelly Indicators Row */}
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border/20">
          <MiniEnsembleScore signals={ensembleSignals} />
          <MiniKellyIndicator winProbability={bestHitRate} americanOdds={propOdds} />
        </div>
        
        {/* Season Intelligence Row */}
        {(prop.season_avg || prop.consistency_score || prop.trend_direction) && (
          <div className="flex flex-wrap gap-2 pt-1.5 pb-1 border-t border-border/20">
            {/* Season Average vs Line */}
            {prop.season_avg && (
              <div className="flex items-center gap-1.5 text-xs bg-muted/30 rounded px-2 py-0.5">
                <BarChart3 className="h-3 w-3 text-primary" />
                <span className="text-muted-foreground">Season:</span>
                <span className={prop.season_avg > prop.current_line 
                  ? (prop.recommended_side === 'over' ? 'text-neon-green font-medium' : 'text-amber-400 font-medium')
                  : (prop.recommended_side === 'under' ? 'text-neon-green font-medium' : 'text-amber-400 font-medium')
                }>
                  {prop.season_avg}
                </span>
                <span className="text-muted-foreground/70">({prop.season_games_played}g)</span>
              </div>
            )}
            
            {/* Consistency Score */}
            {prop.consistency_score && prop.consistency_score !== 50 && (
              <div className="flex items-center gap-1.5 text-xs">
                <Shield className="h-3 w-3 text-primary" />
                <Badge className={getConsistencyBadgeClass(prop.consistency_score)} variant="outline">
                  {prop.consistency_score >= 70 ? 'Very Consistent' : prop.consistency_score >= 50 ? 'Consistent' : 'Variable'}
                </Badge>
              </div>
            )}
            
            {/* Season Trend */}
            {prop.trend_direction && prop.trend_direction !== 'stable' && (
              <div className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 ${seasonTrendData.class}`}>
                <SeasonTrendIcon className="h-3 w-3" />
                <span>{seasonTrendData.label}</span>
                {prop.season_trend_pct !== undefined && (
                  <span>({prop.season_trend_pct > 0 ? '+' : ''}{prop.season_trend_pct}%)</span>
                )}
              </div>
            )}
            
            {/* Opponent Defense Rank */}
            {prop.opponent_defense_rank && (
              <div className="flex items-center gap-1 text-xs">
                <Thermometer className="h-3 w-3 text-muted-foreground" />
                <span className={
                  prop.opponent_defense_rank <= 10 
                    ? 'text-red-400' 
                    : prop.opponent_defense_rank >= 20 
                      ? 'text-neon-green' 
                      : 'text-muted-foreground'
                }>
                  DEF #{prop.opponent_defense_rank}
                </span>
              </div>
            )}
          </div>
        )}
        
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
          
          {/* Home/Away Adjustment */}
          {prop.home_away_adjustment !== undefined && prop.home_away_adjustment !== 0 && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">H/A Adj:</span>
              <span className={prop.home_away_adjustment > 0 ? 'text-neon-green font-medium' : 'text-red-400 font-medium'}>
                {prop.home_away_adjustment > 0 ? '+' : ''}{prop.home_away_adjustment}
              </span>
            </div>
          )}
        </div>
        
        {/* PROMINENT Opponent Impact Card */}
        {hasOpponentData && (
          <OpponentImpactCard
            playerName={prop.player_name}
            opponent={prop.opponent_name || 'Opponent'}
            propType={prop.prop_type}
            overallHitRate={bestHitRate}
            overallMedian={overallMedian}
            vsOpponentHitRate={prop.vs_opponent_hit_rate || 0}
            vsOpponentMedian={vsOpponentMedian}
            vsOpponentGames={prop.vs_opponent_games}
            blendedHitRate={blendedHitRate}
            blendedMedian={blendedMedian}
            impact={opponentImpact}
          />
        )}
        
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
