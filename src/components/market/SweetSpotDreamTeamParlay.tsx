import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Target,
  Trophy,
  Plus,
  Loader2,
  TrendingUp,
  RefreshCw,
  Calendar,
  AlertTriangle,
  Shield,
  Activity,
  Download,
  Layers3,
} from "lucide-react";
import {
  useSweetSpotParlayBuilder,
  type BuilderFunnelMode,
  type RecommendedParlay,
} from "@/hooks/useSweetSpotParlayBuilder";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { PlayerReliabilityBadge } from "@/components/props/PlayerReliabilityBadge";

const getPropTypeColor = (propType: string): string => {
  const type = propType.toLowerCase();
  if (type.includes("point")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (type.includes("rebound")) return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  if (type.includes("assist")) return "bg-green-500/20 text-green-400 border-green-500/30";
  return "bg-muted text-muted-foreground";
};

const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 9.5) return "text-green-400";
  if (confidence >= 9.0) return "text-emerald-400";
  if (confidence >= 8.5) return "text-yellow-400";
  return "text-muted-foreground";
};

const getMarketTone = (status?: string) => {
  switch (status) {
    case "active":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "scanning":
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    case "stale":
      return "bg-slate-500/10 text-slate-300 border-slate-500/30";
    default:
      return "bg-muted/50 text-muted-foreground";
  }
};

function RecommendationCard({
  recommendation,
  onAdd,
}: {
  recommendation: RecommendedParlay | null;
  onAdd: (recommendation: RecommendedParlay | null) => void;
}) {
  if (!recommendation) {
    return (
      <Card className="border-muted bg-muted/10">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No ranked pack available.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 bg-background/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              {recommendation.label}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {recommendation.uniqueTeams} teams · avg safety {recommendation.avgSafetyScore.toFixed(2)}
            </p>
          </div>
          <Button size="sm" onClick={() => onAdd(recommendation)} className="gap-1">
            <Plus className="h-4 w-4" />
            Add {recommendation.legCount}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            <Target className="h-3 w-3" />
            L10 {(recommendation.avgL10HitRate * 100).toFixed(0)}%
          </Badge>
          <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-400 border-green-500/30">
            <TrendingUp className="h-3 w-3" />
            Conf {recommendation.avgConfidence.toFixed(2)}
          </Badge>
          {recommendation.books.length > 0 && (
            <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-400 border-blue-500/30">
              <Layers3 className="h-3 w-3" />
              {recommendation.books.join(" · ")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap gap-1.5">
          {recommendation.reasons.map((reason) => (
            <Badge key={reason} variant="outline" className="text-[10px] bg-muted/40">
              {reason}
            </Badge>
          ))}
        </div>

        <div className="space-y-2">
          {recommendation.legs.map((leg, index) => (
            <div
              key={`${recommendation.key}-${leg.pick.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold">
                    {index + 1}
                  </div>
                  <span className="font-medium text-sm">{leg.pick.player_name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {leg.team}
                  </Badge>
                  {leg.pick.reliabilityTier ? (
                    <PlayerReliabilityBadge
                      tier={leg.pick.reliabilityTier}
                      hitRate={leg.pick.reliabilityHitRate}
                      modifier={leg.pick.reliabilityModifier}
                      size="sm"
                    />
                  ) : null}
                  {leg.pick.injuryStatus && (
                    <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30 gap-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {leg.pick.injuryStatus}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge className={`text-[10px] px-1.5 py-0 ${getPropTypeColor(leg.pick.prop_type)}`}>
                    {leg.pick.prop_type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {leg.pick.side.toUpperCase()} {leg.pick.line}
                  </span>
                  {leg.pick.qualityTier && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {leg.pick.qualityTier}
                    </Badge>
                  )}
                  <Badge className={`text-[10px] px-1.5 py-0 ${getMarketTone(leg.pick.marketStatus)}`}>
                    {leg.pick.marketStatus || "ranked"}
                  </Badge>
                </div>
                {leg.pick.recommendationReason && (
                  <p className="text-[11px] text-muted-foreground mt-2 line-clamp-2">
                    {leg.pick.recommendationReason}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 text-right shrink-0">
                {leg.gameContext && (
                  <div className="hidden sm:block">
                    <div className="text-[10px] font-medium text-slate-300">{leg.gameContext.gameScript}</div>
                    <div className="text-[9px] text-muted-foreground">{leg.gameContext.vegasTotal}</div>
                  </div>
                )}
                <div>
                  <div className={`text-sm font-bold ${getConfidenceColor(leg.pick.confidence_score)}`}>
                    {leg.pick.confidence_score.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">conf</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-primary">
                    {(leg.pick.safetyScore || leg.score).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">safe</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SweetSpotDreamTeamParlay() {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [funnelMode, setFunnelMode] = useState<BuilderFunnelMode>("aggressive");
  const {
    recommendedParlays,
    coreRecommendedParlays,
    poolStats,
    isLoading,
    refetch,
    addRecommendationToBuilder,
    slateStatus,
    activePreset,
    exportFrozenSlate,
  } = useSweetSpotParlayBuilder();

  const activePacks = funnelMode === "core" ? coreRecommendedParlays : recommendedParlays;
  const cards = [activePacks.twoLeg, activePacks.threeLeg, activePacks.fourLeg].filter(Boolean);

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      toast.info("Refreshing Sweet Spot slate...");
      await supabase.functions.invoke("category-props-analyzer", {
        body: { forceRefresh: true },
      });
      await supabase.functions.invoke("nba-player-prop-risk-engine", {
        body: { action: "analyze_slate", mode: "full_slate" },
      });
      await refetch();
      toast.success("Sweet Spot recommendations refreshed");
    } catch (err) {
      console.error("Regeneration error:", err);
      toast.error("Failed to regenerate picks");
    } finally {
      setIsRegenerating(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-primary/20 bg-gradient-to-br from-background to-primary/5">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (cards.length === 0) {
    return (
      <Card className="border-muted bg-muted/10">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <Target className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-muted-foreground text-sm">No Sweet Spot packs available</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={handleRegenerate}
            disabled={isRegenerating || isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? "animate-spin" : ""}`} />
            Build Now
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-background via-primary/5 to-background overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/20">
              <Trophy className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-lg font-bold">Sweet Spot Builder Packs</CardTitle>
                <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                  widest slate first
                </Badge>
                {slateStatus?.isNextSlate && (
                  <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">
                    <Calendar className="h-3 w-3" />
                    {format(parseISO(slateStatus.displayedDate), "EEE MMM d")}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Auto-ranked safest 2–4 legs · preset {activePreset}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={exportFrozenSlate}
              disabled={isLoading}
              className="gap-2 text-muted-foreground hover:text-foreground"
              title={`Export slate for testing (${slateStatus?.displayedDate || "today"} · ${activePreset})`}
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={isRegenerating || isLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isRegenerating ? "animate-spin" : ""}`} />
              {isRegenerating ? "Building..." : "Build Now"}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <Tabs value={funnelMode} onValueChange={(value) => setFunnelMode(value as BuilderFunnelMode)}>
            <TabsList className="grid grid-cols-2 w-[240px]">
              <TabsTrigger value="core">Core</TabsTrigger>
              <TabsTrigger value="aggressive">Aggressive</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-400 border-green-500/30">
              <Activity className="h-3 w-3" />
              {poolStats.candidateCount} ranked
            </Badge>
            <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              active {poolStats.activeCount}
            </Badge>
            <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-400 border-amber-500/30">
              scanning {poolStats.scanningCount}
            </Badge>
            <Badge variant="outline" className="gap-1 bg-slate-500/10 text-slate-300 border-slate-500/30">
              stale {poolStats.staleCount}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {cards.map((recommendation) => (
          <RecommendationCard
            key={recommendation!.key}
            recommendation={recommendation!}
            onAdd={addRecommendationToBuilder}
          />
        ))}
      </CardContent>
    </Card>
  );
}
