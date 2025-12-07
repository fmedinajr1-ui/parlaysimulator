import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Star, Zap, ArrowRight, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PVSParlay, PVSParlayLeg, PVS_TIER_CONFIG } from "@/types/pvs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PVSAutoParlaysProps {
  onSelectParlay?: (legs: any[]) => void;
}

export function PVSAutoParlays({ onSelectParlay }: PVSAutoParlaysProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const queryClient = useQueryClient();

  const { data: parlays, isLoading, refetch } = useQuery({
    queryKey: ['pvs-parlays'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pvs_parlays')
        .select('*')
        .eq('is_active', true)
        .order('combined_pvs_score', { ascending: false });

      if (error) throw error;
      return (data || []).map(p => ({
        ...p,
        parlay_type: p.parlay_type as 'safe_2leg' | 'value_3leg',
        legs: p.legs as unknown as PVSParlayLeg[]
      })) as PVSParlay[];
    }
  });

  const handleGenerateParlays = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('unified-props-engine', {
        body: { sports: ['basketball_nba', 'hockey_nhl'] }
      });

      if (error) throw error;

      toast.success('Parlays generated successfully!', {
        description: `Analyzed ${data.totalPropsAnalyzed} props`
      });

      // Refetch parlays
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['pvs-props'] });
    } catch (err: any) {
      console.error('Error generating parlays:', err);
      toast.error('Failed to generate parlays', {
        description: err.message
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const formatOdds = (odds: number | null) => {
    if (odds === null || odds === undefined) return '-';
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  const formatPropType = (propType: string) => {
    return propType
      .replace('player_', '')
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const safe2Leg = parlays?.find(p => p.parlay_type === 'safe_2leg');
  const value3Leg = parlays?.find(p => p.parlay_type === 'value_3leg');

  if (!safe2Leg && !value3Leg) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <Zap className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground mb-1">No auto-generated parlays available yet</p>
          <p className="text-xs text-muted-foreground mb-4">Run the PVS engine to generate optimal parlays</p>
          <Button 
            onClick={handleGenerateParlays} 
            disabled={isGenerating}
            className="bg-primary hover:bg-primary/90"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Generate AI Parlays
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">AI-Generated Parlays</h3>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleGenerateParlays}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Safe 2-Leg Parlay */}
        {safe2Leg && (
          <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Trophy className="h-5 w-5 text-emerald-400" />
                Safe 2-Leg Parlay
                <Badge className="bg-emerald-500/20 text-emerald-400 border-0 ml-auto">
                  {safe2Leg.combined_pvs_score.toFixed(0)} PVS
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(safe2Leg.legs as any[]).map((leg, index) => (
                <div key={index} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{leg.player_name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className={cn(
                        "font-semibold flex items-center gap-0.5",
                        leg.side === 'over' ? "text-emerald-400" : "text-red-400"
                      )}>
                        {leg.side === 'over' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {leg.side?.toUpperCase()}
                      </span>
                      <span>{leg.line}</span>
                      <span className="text-muted-foreground">{formatPropType(leg.prop_type)}</span>
                    </div>
                  </div>
                  <Badge 
                    className={cn("text-xs", PVS_TIER_CONFIG[leg.pvs_tier as keyof typeof PVS_TIER_CONFIG]?.bgColor, PVS_TIER_CONFIG[leg.pvs_tier as keyof typeof PVS_TIER_CONFIG]?.color)}
                  >
                    {leg.pvs_score?.toFixed(0) || 0}
                  </Badge>
                </div>
              ))}

              <div className="flex items-center justify-between pt-2 border-t border-border/30">
                <div className="text-sm">
                  <span className="text-muted-foreground">Odds: </span>
                  <span className="font-bold font-mono text-primary">{formatOdds(safe2Leg.total_odds)}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Win Prob: </span>
                  <span className="font-bold text-emerald-400">{(safe2Leg.combined_probability * 100).toFixed(1)}%</span>
                </div>
              </div>

              {onSelectParlay && (
                <Button 
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => onSelectParlay(safe2Leg.legs as any[])}
                >
                  Use This Parlay
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Value 3-Leg Parlay */}
        {value3Leg && (
          <Card className="border-yellow-500/30 bg-gradient-to-br from-yellow-500/5 to-transparent">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Star className="h-5 w-5 text-yellow-400" />
                Value 3-Leg Parlay
                <Badge className="bg-yellow-500/20 text-yellow-400 border-0 ml-auto">
                  {value3Leg.combined_pvs_score.toFixed(0)} PVS
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(value3Leg.legs as any[]).map((leg, index) => (
                <div key={index} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center text-xs font-bold text-yellow-400">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{leg.player_name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className={cn(
                        "font-semibold flex items-center gap-0.5",
                        leg.side === 'over' ? "text-emerald-400" : "text-red-400"
                      )}>
                        {leg.side === 'over' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {leg.side?.toUpperCase()}
                      </span>
                      <span>{leg.line}</span>
                      <span className="text-muted-foreground">{formatPropType(leg.prop_type)}</span>
                    </div>
                  </div>
                  <Badge 
                    className={cn("text-xs", PVS_TIER_CONFIG[leg.pvs_tier as keyof typeof PVS_TIER_CONFIG]?.bgColor, PVS_TIER_CONFIG[leg.pvs_tier as keyof typeof PVS_TIER_CONFIG]?.color)}
                  >
                    {leg.pvs_score?.toFixed(0) || 0}
                  </Badge>
                </div>
              ))}

              <div className="flex items-center justify-between pt-2 border-t border-border/30">
                <div className="text-sm">
                  <span className="text-muted-foreground">Odds: </span>
                  <span className="font-bold font-mono text-primary">{formatOdds(value3Leg.total_odds)}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Win Prob: </span>
                  <span className="font-bold text-yellow-400">{(value3Leg.combined_probability * 100).toFixed(1)}%</span>
                </div>
              </div>

              {onSelectParlay && (
                <Button 
                  className="w-full bg-yellow-600 hover:bg-yellow-700"
                  onClick={() => onSelectParlay(value3Leg.legs as any[])}
                >
                  Use This Parlay
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
