import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Target, TrendingUp, Loader2, CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { AltLineComparisonCard } from "./AltLineComparisonCard";
import { PlayerReliabilityBadge } from "@/components/props/PlayerReliabilityBadge";

interface SweetSpotPick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  confidence_score: number;
  edge: number | null;
  archetype: string | null;
  outcome: string | null;
  game_date: string;
  created_at: string;
  alt_line_recommendation?: number | null;
  alt_line_reason?: string | null;
  is_juiced?: boolean;
  juice_magnitude?: number;
  line_warning?: string | null;
  player_hit_rate?: number | null;
  player_reliability_tier?: string | null;
  reliability_modifier_applied?: number | null;
}

interface RiskEngineSweetSpot {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  confidence_score: number;
  edge?: number | null;
  archetype?: string | null;
  outcome: string | null;
  game_date: string;
  is_sweet_spot?: boolean;
  sweet_spot_reason?: string | null;
  alt_line_recommendation?: number | null;
  alt_line_reason?: string | null;
  is_juiced?: boolean;
  juice_magnitude?: number;
  line_warning?: string | null;
  player_hit_rate?: number | null;
  player_reliability_tier?: string | null;
  reliability_modifier_applied?: number | null;
}

const SWEET_SPOT_RANGES = {
  points: { min: 8.5, max: 9.5, label: "Points 8.5-9.5", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  rebounds: { min: 9.0, max: 9.8, label: "Rebounds 9.0-9.8", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  assists: { min: 7.5, max: 9.0, label: "Assists 7.5-9.0", color: "bg-green-500/20 text-green-400 border-green-500/30" },
};

function getPropTypeColor(propType: string): string {
  const normalized = propType.toLowerCase();
  if (normalized.includes("point")) return SWEET_SPOT_RANGES.points.color;
  if (normalized.includes("rebound")) return SWEET_SPOT_RANGES.rebounds.color;
  if (normalized.includes("assist")) return SWEET_SPOT_RANGES.assists.color;
  return "bg-muted text-muted-foreground";
}

function getOutcomeIcon(outcome: string | null) {
  if (!outcome || outcome === "pending") {
    return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
  if (outcome === "hit") {
    return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  }
  return <XCircle className="w-4 h-4 text-red-500" />;
}

function formatPropType(propType: string): string {
  return propType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SweetSpotPicksCard() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch from sweet_spot_tracking table
  const { data: trackedPicks, isLoading: trackingLoading, refetch: refetchTracking } = useQuery({
    queryKey: ["sweet-spot-tracking"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("sweet_spot_tracking")
        .select("*")
        .gte("game_date", today)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as SweetSpotPick[];
    },
    refetchInterval: 60000,
  });

  // Also fetch sweet spot picks from risk engine
  const { data: riskEngineSweetSpots, isLoading: riskLoading, refetch: refetchRiskEngine } = useQuery({
    queryKey: ["sweet-spot-risk-engine"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("nba_risk_engine_picks")
        .select("id, player_name, prop_type, line, side, confidence_score, edge, archetype, outcome, game_date, is_sweet_spot, sweet_spot_reason, alt_line_recommendation, alt_line_reason, is_juiced, juice_magnitude, line_warning, player_hit_rate, player_reliability_tier, reliability_modifier_applied")
        .eq("is_sweet_spot", true)
        .eq("game_date", today)
        .order("confidence_score", { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as RiskEngineSweetSpot[];
    },
    refetchInterval: 60000,
  });

  const isLoading = trackingLoading || riskLoading;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await supabase.functions.invoke('nba-player-prop-risk-engine', {
        body: { action: 'analyze_slate', mode: 'full_slate' }
      });
      await Promise.all([refetchTracking(), refetchRiskEngine()]);
      toast.success('Sweet spot picks refreshed!');
    } catch (err) {
      console.error('Refresh error:', err);
      toast.error('Failed to refresh picks');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Combine and dedupe picks (prefer tracked picks)
  const allPicks = [
    ...(trackedPicks || []),
    ...(riskEngineSweetSpots || []).filter(
      (rp) => !trackedPicks?.some((tp) => tp.player_name === rp.player_name && tp.prop_type === rp.prop_type && tp.line === rp.line)
    ),
  ];

  // Calculate stats
  const hitCount = allPicks.filter((p) => p.outcome === "hit").length;
  const missCount = allPicks.filter((p) => p.outcome === "miss").length;
  const pendingCount = allPicks.filter((p) => !p.outcome || p.outcome === "pending").length;

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
              <span className="text-green-500">{hitCount} hit</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-red-400">{missCount} miss</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">{pendingCount} pending</span>
            </div>
          )}
        </div>
        <CardDescription className="text-xs">
          Optimal confidence ranges with historically higher hit rates
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Sweet Spot Legend */}
        <div className="flex flex-wrap gap-2 mb-2">
          {Object.entries(SWEET_SPOT_RANGES).map(([key, range]) => (
            <Badge key={key} variant="outline" className={cn("text-xs", range.color)}>
              {range.label}
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
            <p className="text-xs mt-1">Run the Risk Engine to find optimal plays</p>
          </div>
        ) : (
          <div className="space-y-3">
            {allPicks.map((pick) => (
              <div key={pick.id}>
                <div
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border",
                    "bg-background/50 hover:bg-background/80 transition-colors",
                    pick.outcome === "hit" && "border-green-500/30 bg-green-500/5",
                    pick.outcome === "miss" && "border-red-500/30 bg-red-500/5",
                    pick.is_juiced && !pick.outcome && "border-amber-500/30"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {getOutcomeIcon(pick.outcome)}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{pick.player_name}</p>
                        <PlayerReliabilityBadge 
                          tier={pick.player_reliability_tier}
                          hitRate={pick.player_hit_rate}
                          modifier={pick.reliability_modifier_applied}
                        />
                        {pick.is_juiced && (
                          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                            JUICED
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className={cn("text-xs", getPropTypeColor(pick.prop_type))}>
                          {formatPropType(pick.prop_type)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {pick.side?.toUpperCase()} {pick.line}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <div className="flex items-center gap-1 justify-end">
                        <TrendingUp className="w-3 h-3 text-primary" />
                        <span className="text-sm font-semibold text-primary">
                          {pick.confidence_score?.toFixed(1)}
                        </span>
                      </div>
                      {pick.edge && (
                        <p className="text-xs text-green-400">+{pick.edge.toFixed(1)} edge</p>
                      )}
                    </div>
                    {pick.archetype && (
                      <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
                        {pick.archetype.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Alt Line Comparison Card */}
                {pick.alt_line_recommendation && (
                  <AltLineComparisonCard
                    playerName={pick.player_name}
                    propType={pick.prop_type}
                    currentLine={pick.line}
                    side={pick.side}
                    altLineRecommendation={pick.alt_line_recommendation}
                    altLineReason={pick.alt_line_reason || null}
                    isJuiced={pick.is_juiced || false}
                    juiceMagnitude={pick.juice_magnitude}
                    lineWarning={pick.line_warning}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
