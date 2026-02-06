import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Target, TrendingUp, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AltLineComparisonCard } from "./AltLineComparisonCard";
import { PlayerReliabilityBadge } from "@/components/props/PlayerReliabilityBadge";

// Get today's date in Eastern Time for consistent filtering
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

interface CategorySweetSpot {
  id: string;
  player_name: string;
  prop_type: string;
  actual_line: number | null;
  recommended_line: number | null;
  recommended_side: string | null;
  confidence_score: number | null;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  category: string;
  archetype: string | null;
  analysis_date: string;
  is_active: boolean | null;
  // v4.0: True projections
  projected_value: number | null;
  matchup_adjustment: number | null;
  pace_adjustment: number | null;
  projection_source: string | null;
}

// Category display config
// v7.0: Removed MID_SCORER_UNDER (disabled due to 45% hit rate - includes starters who explode)
const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  ELITE_REB_OVER: { label: "Elite Rebounder", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  ROLE_PLAYER_REB: { label: "Role Player Reb", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  BIG_ASSIST_OVER: { label: "Big Assist", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  LOW_SCORER_UNDER: { label: "Low Scorer Under", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  STAR_FLOOR_OVER: { label: "Star Floor", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  ASSIST_ANCHOR: { label: "Assist Anchor", color: "bg-teal-500/20 text-teal-400 border-teal-500/30" },
  HIGH_REB_UNDER: { label: "High Reb Under", color: "bg-rose-500/20 text-rose-400 border-rose-500/30" },
  // MID_SCORER_UNDER removed - 45% hit rate, includes starters
};

function getPropTypeColor(propType: string): string {
  const normalized = propType.toLowerCase();
  if (normalized.includes("point")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (normalized.includes("rebound")) return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  if (normalized.includes("assist")) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (normalized.includes("three")) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return "bg-muted text-muted-foreground";
}

function getCategoryBadge(category: string) {
  const config = CATEGORY_CONFIG[category];
  if (!config) return null;
  return (
    <Badge variant="outline" className={cn("text-[10px]", config.color)}>
      {config.label}
    </Badge>
  );
}

function formatPropType(propType: string): string {
  return propType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getHitRateColor(hitRate: number | null): string {
  if (!hitRate) return "text-muted-foreground";
  if (hitRate >= 0.9) return "text-green-400";
  if (hitRate >= 0.75) return "text-emerald-400";
  if (hitRate >= 0.6) return "text-yellow-400";
  return "text-red-400";
}

export function SweetSpotPicksCard() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();

  // Fetch from category_sweet_spots table - the source of truth for today's picks
  const { data: categoryPicks, isLoading, refetch } = useQuery({
    queryKey: ["category-sweet-spots-display"],
    queryFn: async () => {
      const today = getEasternDate();
      
      // Fetch high-confidence sweet spots with projection data
      const { data, error } = await supabase
        .from("category_sweet_spots")
        .select("id, player_name, prop_type, actual_line, recommended_line, recommended_side, confidence_score, l10_hit_rate, l10_avg, category, archetype, analysis_date, is_active, projected_value, matchup_adjustment, pace_adjustment, projection_source")
        .eq("analysis_date", today)
        .eq("is_active", true)
        .gte("l10_hit_rate", 0.70)
        .gte("confidence_score", 0.75)
        .in("category", Object.keys(CATEGORY_CONFIG))
        .order("l10_hit_rate", { ascending: false })
        .limit(30);

      if (error) throw error;
      
      // Dedupe by player + prop type (keep highest hit rate)
      const seen = new Set<string>();
      const dedupedPicks = (data || []).filter(pick => {
        const key = `${pick.player_name}-${pick.prop_type}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      
      return dedupedPicks.slice(0, 15) as CategorySweetSpot[];
    },
    refetchInterval: 60000,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await supabase.functions.invoke('category-props-analyzer', {
        body: { forceRefresh: true }
      });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['sweet-spot-parlay-builder'] });
      toast.success('Sweet spot picks refreshed from category analyzer!');
    } catch (err) {
      console.error('Refresh error:', err);
      toast.error('Failed to refresh picks');
    } finally {
      setIsRefreshing(false);
    }
  };

  const allPicks = categoryPicks || [];
  
  // Group stats by hit rate tier
  const eliteCount = allPicks.filter(p => (p.l10_hit_rate || 0) >= 0.9).length;
  const strongCount = allPicks.filter(p => (p.l10_hit_rate || 0) >= 0.75 && (p.l10_hit_rate || 0) < 0.9).length;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Sweet Spot Picks</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          {allPicks.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-400">{eliteCount} elite</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-emerald-400">{strongCount} strong</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">{allPicks.length} total</span>
            </div>
          )}
        </div>
        <CardDescription className="text-xs">
          High-confidence picks from category analysis with 70%+ L10 hit rates
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Category Legend */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {Object.entries(CATEGORY_CONFIG).slice(0, 4).map(([key, config]) => (
            <Badge key={key} variant="outline" className={cn("text-[10px]", config.color)}>
              {config.label}
            </Badge>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : allPicks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No sweet spot picks yet today</p>
            <p className="text-xs mt-1">Run the Category Analyzer to find optimal plays</p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="mt-3"
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", isRefreshing && "animate-spin")} />
              Analyze Categories
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {allPicks.map((pick) => {
              const line = pick.actual_line ?? pick.recommended_line ?? 0;
              const hitRate = pick.l10_hit_rate ?? 0;
              
              return (
                <div
                  key={pick.id}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border",
                    "bg-background/50 hover:bg-background/80 transition-colors",
                    hitRate >= 0.9 && "border-green-500/30 bg-green-500/5",
                    hitRate >= 0.75 && hitRate < 0.9 && "border-emerald-500/20"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {hitRate >= 0.9 ? (
                      <Sparkles className="w-4 h-4 text-green-400" />
                    ) : (
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{pick.player_name}</p>
                        {getCategoryBadge(pick.category)}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <Badge variant="outline" className={cn("text-xs", getPropTypeColor(pick.prop_type))}>
                          {formatPropType(pick.prop_type)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {pick.recommended_side?.toUpperCase()} {line}
                        </span>
                        {/* v4.0: Show projection and edge */}
                        {pick.projected_value && (
                          <span className="text-xs font-mono">
                            <span className="text-primary">Proj: {pick.projected_value}</span>
                            {pick.actual_line && (
                              <span className={cn(
                                "ml-1",
                                (pick.projected_value - pick.actual_line) > 0 && pick.recommended_side === 'over' && "text-green-400",
                                (pick.projected_value - pick.actual_line) < 0 && pick.recommended_side === 'under' && "text-green-400",
                                (pick.projected_value - pick.actual_line) > 0 && pick.recommended_side === 'under' && "text-red-400",
                                (pick.projected_value - pick.actual_line) < 0 && pick.recommended_side === 'over' && "text-red-400"
                              )}>
                                ({(pick.projected_value - pick.actual_line) > 0 ? '+' : ''}{(pick.projected_value - pick.actual_line).toFixed(1)})
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <div className="flex items-center gap-1 justify-end">
                        <span className={cn("text-sm font-semibold", getHitRateColor(hitRate))}>
                          {(hitRate * 100).toFixed(0)}%
                        </span>
                        <span className="text-xs text-muted-foreground">L10</span>
                      </div>
                      {pick.confidence_score && (
                        <p className="text-xs text-primary">
                          {(pick.confidence_score * 10).toFixed(1)} conf
                        </p>
                      )}
                    </div>
                    {pick.l10_avg !== null && (
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-muted-foreground">Avg</p>
                        <p className="text-sm font-medium">{pick.l10_avg?.toFixed(1)}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
