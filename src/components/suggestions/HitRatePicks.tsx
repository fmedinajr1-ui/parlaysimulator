import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HitRateParlayCard } from "./HitRateParlayCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Target, Zap, TrendingUp, TrendingDown, Minus, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Calculate trend from game logs (recent games vs older games)
const calculateTrend = (gameLogs: any[], line: number, side: 'over' | 'under'): 'up' | 'down' | 'neutral' => {
  if (!gameLogs || gameLogs.length < 4) return 'neutral';
  
  // Split into recent (last 2) and older (rest) games
  const recentGames = gameLogs.slice(0, 2);
  const olderGames = gameLogs.slice(2);
  
  if (olderGames.length === 0) return 'neutral';
  
  // Calculate hit rates for each period
  const recentHits = recentGames.filter((g: any) => 
    side === 'over' ? g.value > line : g.value < line
  ).length / recentGames.length;
  
  const olderHits = olderGames.filter((g: any) => 
    side === 'over' ? g.value > line : g.value < line
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

const HIT_RATE_OPTIONS = [
  { value: 0.4, label: "40%+" },
  { value: 0.5, label: "50%+" },
  { value: 0.6, label: "60%+" },
  { value: 0.7, label: "70%+" },
  { value: 0.8, label: "80%+" },
];

const getHitRateBadgeClass = (rate: number) => {
  if (rate >= 0.9) return 'bg-neon-green/20 text-neon-green border-neon-green/30'; // Exceptional
  if (rate >= 0.8) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'; // Excellent
  if (rate >= 0.7) return 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30'; // Good
  if (rate >= 0.6) return 'bg-amber-500/20 text-amber-400 border-amber-500/30'; // Above average
  if (rate >= 0.5) return 'bg-orange-500/20 text-orange-400 border-orange-500/30'; // Moderate (50-60%)
  return 'bg-red-500/20 text-red-400 border-red-500/30'; // Lower (40-50%)
};

export function HitRatePicks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [hitRateThreshold, setHitRateThreshold] = useState(0.6);

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

  // Fetch individual high hit-rate props
  const { data: props, isLoading: propsLoading } = useQuery({
    queryKey: ['hitrate-props', hitRateThreshold],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_prop_hitrates')
        .select('*')
        .or(`hit_rate_over.gte.${hitRateThreshold},hit_rate_under.gte.${hitRateThreshold}`)
        .gt('expires_at', new Date().toISOString())
        .order('confidence_score', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data || [];
    }
  });

  // Analyze props mutation
  const analyzeProps = async () => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-hitrate-props', {
        body: { 
          sports: ['basketball_nba', 'americanfootball_nfl', 'icehockey_nhl'],
          minHitRate: hitRateThreshold 
        }
      });

      if (error) throw error;

      toast({
        title: "Analysis Complete",
        description: `Found ${data.analyzed} props with ${Math.round(hitRateThreshold * 100)}%+ hit rates`,
      });

      queryClient.invalidateQueries({ queryKey: ['hitrate-props', hitRateThreshold] });
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

      queryClient.invalidateQueries({ queryKey: ['hitrate-parlays', hitRateThreshold] });
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

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Hit Rate Threshold Selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground whitespace-nowrap">Min Hit Rate:</label>
          <Select 
            value={String(hitRateThreshold)} 
            onValueChange={(v) => setHitRateThreshold(Number(v))}
          >
            <SelectTrigger className="w-24 bg-background border-border">
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

        <div className="flex gap-3 flex-1 w-full sm:w-auto">
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
            Scan Hit Rates
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
                onRunSharpAnalysis={async (id) => {
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

      {/* Individual Props Section */}
      {!isLoading && props && props.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            High Hit-Rate Props ({props.length})
          </h3>
          <div className="grid gap-3">
            {props.map((prop: any) => {
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
              
              return (
                <Card key={prop.id} className="bg-card/60 border-border/30">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {prop.player_name}
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
                      <div className="text-right">
                        <Badge className={getHitRateBadgeClass(bestHitRate)}>
                          {hits}/{prop.games_analyzed} ({formatHitRate(bestHitRate)})
                        </Badge>
                        <div className="text-xs text-muted-foreground mt-1">
                          {prop.confidence_score}% confident
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && (!props || props.length === 0) && (!parlays || parlays.length === 0) && (
        <Card className="bg-card/60 border-border/30">
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold mb-2">No Hit Rate Data Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Click "Scan Hit Rates" to analyze player props based on historical performance
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
