import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HitRateParlayCard } from "./HitRateParlayCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Target, Zap, TrendingUp, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function HitRatePicks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);

  // Fetch existing hit rate parlays
  const { data: parlays, isLoading: parlaysLoading } = useQuery({
    queryKey: ['hitrate-parlays'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hitrate_parlays')
        .select('*')
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch individual high hit-rate props
  const { data: props, isLoading: propsLoading } = useQuery({
    queryKey: ['hitrate-props'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_prop_hitrates')
        .select('*')
        .or('hit_rate_over.gte.0.8,hit_rate_under.gte.0.8')
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
          minHitRate: 0.8 
        }
      });

      if (error) throw error;

      toast({
        title: "Analysis Complete",
        description: `Found ${data.analyzed} props with 80%+ hit rates`,
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
          minHitRate: 0.8,
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

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
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
              
              return (
                <Card key={prop.id} className="bg-card/60 border-border/30">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{prop.player_name}</div>
                        <div className="text-sm text-muted-foreground">
                          {prop.recommended_side.toUpperCase()} {prop.current_line}{' '}
                          {PROP_LABELS[prop.prop_type] || prop.prop_type}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {prop.game_description}
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge 
                          className={`${
                            bestHitRate >= 1 
                              ? 'bg-neon-green/20 text-neon-green border-neon-green/30' 
                              : 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30'
                          }`}
                        >
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
