import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Target, Trophy, Zap, Users, Plus, Loader2, TrendingUp, RefreshCw, Calendar, AlertTriangle, History } from "lucide-react";
import { useSweetSpotParlayBuilder } from "@/hooks/useSweetSpotParlayBuilder";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

const getPropTypeColor = (propType: string): string => {
  const type = propType.toLowerCase();
  if (type.includes('point')) return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  if (type.includes('rebound')) return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
  if (type.includes('assist')) return 'bg-green-500/20 text-green-400 border-green-500/30';
  return 'bg-muted text-muted-foreground';
};

const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 9.5) return 'text-green-400';
  if (confidence >= 9.0) return 'text-emerald-400';
  if (confidence >= 8.5) return 'text-yellow-400';
  return 'text-muted-foreground';
};

const getCategoryLabel = (category: string | null | undefined): string => {
  if (!category) return '';
  switch (category) {
    // OPTIMAL WINNERS v3.0 (User's winning patterns)
    case 'ELITE_REB_OVER': return '🏀 Elite Reb';
    case 'ROLE_PLAYER_REB': return '📈 Role Reb';
    case 'BIG_ASSIST_OVER': return '🎯 Big Ast';
    case 'LOW_SCORER_UNDER': return '📉 Low Pts';
    case 'STAR_FLOOR_OVER': return '⭐ Star Floor';
    // PROVEN WINNERS v2.0
    case 'ASSIST_ANCHOR': return '📊 Ast Under';
    case 'HIGH_REB_UNDER': return '📊 Reb Under';
    case 'MID_SCORER_UNDER': return '📊 Pts Under';
    // Legacy
    case 'BIG_REBOUNDER': return 'Big Reb';
    case 'LOW_LINE_REBOUNDER': return 'Low Reb';
    case 'NON_SCORING_SHOOTER': return 'Non-Scorer';
    default: return category.replace(/_/g, ' ');
  }
};

const getCategoryColor = (category: string | null | undefined): string => {
  if (!category) return 'bg-muted/50 text-muted-foreground';
  switch (category) {
    // OPTIMAL WINNERS v3.0 - Green/Winner styling for OVERS
    case 'ELITE_REB_OVER': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'ROLE_PLAYER_REB': return 'bg-teal-500/20 text-teal-400 border-teal-500/30';
    case 'BIG_ASSIST_OVER': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'STAR_FLOOR_OVER': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    // OPTIMAL WINNERS v3.0 - Red styling for UNDERS
    case 'LOW_SCORER_UNDER': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
    // PROVEN WINNERS v2.0 - Gold/Winner styling
    case 'ASSIST_ANCHOR': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'HIGH_REB_UNDER': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'MID_SCORER_UNDER': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    // Legacy
    case 'BIG_REBOUNDER': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'LOW_LINE_REBOUNDER': return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    case 'NON_SCORING_SHOOTER': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    default: return 'bg-muted/50 text-muted-foreground';
  }
};

export function SweetSpotDreamTeamParlay() {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const { 
    optimalParlay, 
    combinedStats, 
    isLoading, 
    addOptimalParlayToBuilder,
    refetch,
    slateStatus
  } = useSweetSpotParlayBuilder();

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      toast.info('Refreshing proven winner categories...');
      
      // Step 1: Refresh proven winner categories first
      await supabase.functions.invoke('category-props-analyzer', {
        body: { forceRefresh: true }
      });
      
      // Step 2: Refresh risk engine picks  
      await supabase.functions.invoke('nba-player-prop-risk-engine', {
        body: { action: 'analyze_slate', mode: 'full_slate' }
      });
      
      await refetch();
      toast.success('Dream Team parlay regenerated!');
    } catch (err) {
      console.error('Regeneration error:', err);
      toast.error('Failed to regenerate picks');
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

  if (optimalParlay.length === 0) {
    return (
      <Card className="border-muted bg-muted/10">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <Target className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-muted-foreground text-sm">No sweet spot picks available for Dream Team parlay</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-background via-primary/5 to-background overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/20">
              <Trophy className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-bold">💰 Optimal Parlay</CardTitle>
                <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                  $714+ Pattern
                </Badge>
                {slateStatus?.isNextSlate && (
                  <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">
                    <Calendar className="h-3 w-3" />
                    {format(parseISO(slateStatus.displayedDate), 'EEE MMM d')}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {combinedStats.legCount}-leg parlay • Based on winning slip patterns
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              disabled={isRegenerating || isLoading}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className={`h-4 w-4 ${isRegenerating ? 'animate-spin' : ''}`} />
            </Button>
            <Button 
              size="sm" 
              onClick={addOptimalParlayToBuilder}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add to Builder
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex gap-3 mt-3 flex-wrap">
          {combinedStats.avgL10HitRate > 0 && (
            <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              <Target className="h-3 w-3" />
              L10: {(combinedStats.avgL10HitRate * 100).toFixed(0)}%
            </Badge>
          )}
          <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-400 border-green-500/30">
            <TrendingUp className="h-3 w-3" />
            Avg Conf: {combinedStats.avgConfidence.toFixed(2)}
          </Badge>
          <Badge variant="outline" className="gap-1 bg-purple-500/10 text-purple-400 border-purple-500/30">
            <Users className="h-3 w-3" />
            {combinedStats.uniqueTeams} Teams
          </Badge>
          <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-400 border-amber-500/30">
            <Zap className="h-3 w-3" />
            {combinedStats.propTypes.join(' + ')}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-2">
          {optimalParlay.map((leg, index) => (
            <div 
              key={leg.pick.id} 
              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold">
                  {index + 1}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{leg.pick.player_name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {leg.team}
                    </Badge>
                    {leg.pick.injuryStatus && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30 gap-0.5">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {leg.pick.injuryStatus}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge className={`text-[10px] px-1.5 py-0 ${getPropTypeColor(leg.pick.prop_type)}`}>
                      {leg.pick.prop_type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {leg.pick.side.toUpperCase()} {leg.pick.line}
                    </span>
                    {leg.pick.category && (
                      <Badge className={`text-[10px] px-1.5 py-0 ${getCategoryColor(leg.pick.category)}`}>
                        {getCategoryLabel(leg.pick.category)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-right">
                {leg.pick.l10HitRate && (
                  <div>
                    <div className="text-sm font-bold text-emerald-400">
                      {(leg.pick.l10HitRate * 100).toFixed(0)}%
                    </div>
                    <div className="text-[10px] text-muted-foreground">L10</div>
                  </div>
                )}
                {leg.h2h && leg.h2h.gamesPlayed >= 2 && (
                  <div className="flex items-center gap-1">
                    <History className="h-3 w-3 text-indigo-400" />
                    <div>
                      <div className={`text-sm font-bold ${leg.h2h.hitRate >= 0.6 ? 'text-indigo-400' : leg.h2h.hitRate >= 0.5 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                        {(leg.h2h.hitRate * 100).toFixed(0)}%
                      </div>
                      <div className="text-[10px] text-muted-foreground">H2H</div>
                    </div>
                  </div>
                )}
                <div>
                  <div className={`text-sm font-bold ${getConfidenceColor(leg.pick.confidence_score)}`}>
                    {leg.pick.confidence_score.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">conf</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Category breakdown */}
        {combinedStats.categories.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/50">
            <div className="flex flex-wrap gap-1.5">
              {combinedStats.categories.map(category => (
                <Badge 
                  key={category} 
                  className={`text-[10px] ${getCategoryColor(category)}`}
                >
                  {getCategoryLabel(category)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
