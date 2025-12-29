import { useState } from "react";
import { Calculator, Database, ChevronDown, ChevronUp, RefreshCw, Activity, TrendingUp, TrendingDown, Loader2, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { MedianEdgeCalculator } from "./MedianEdgeCalculator";
import { AutoPicksPaywall } from "./AutoPicksPaywall";
import { usePilotUser } from "@/hooks/usePilotUser";

type ViewMode = "calculator" | "auto";

interface MedianEdgePick {
  id: string;
  player_name: string;
  stat_type: string;
  sportsbook_line: number;
  true_median: number;
  edge: number;
  recommendation: string;
  confidence_flag: string;
  m1_recent_form: number;
  m2_matchup: number;
  m3_minutes_weighted: number;
  adjustments: Record<string, number>;
  reason_summary: string;
  created_at: string;
}

export function MedianEdgePicksCard() {
  const [viewMode, setViewMode] = useState<ViewMode>("calculator");
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();
  const { isAdmin, isSubscribed, isLoading: isUserLoading } = usePilotUser();
  
  // Check if user has access to Auto Picks
  const hasAutoPicksAccess = isAdmin || isSubscribed;
  const { data: picks, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['median-edge-picks'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('median_edge_picks')
        .select('*')
        .eq('game_date', today)
        .order('edge', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(pick => ({
        ...pick,
        adjustments: (pick.adjustments as Record<string, number>) || {},
      })) as MedianEdgePick[];
    },
    enabled: viewMode === "auto"
  });

  const handleRefresh = async () => {
    await refetch();
    toast({
      title: "Refreshed",
      description: "Picks have been refreshed from the database."
    });
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('median-edge-engine', {
        body: { action: 'analyze_auto' }
      });
      
      if (error) throw error;
      
      toast({
        title: "Picks Generated",
        description: `Found ${data?.actionable_picks || 0} actionable picks (${data?.strong_picks || 0} strong, ${data?.lean_picks || 0} lean)`
      });
      
      // Refetch to show new picks
      await refetch();
    } catch (error: any) {
      console.error('Generation error:', error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate picks",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const strongPicks = picks?.filter(p => p.recommendation.includes('STRONG')) || [];
  const leanPicks = picks?.filter(p => p.recommendation.includes('LEAN')) || [];

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex items-center justify-center">
        <ToggleGroup 
          type="single" 
          value={viewMode} 
          onValueChange={(v) => v && setViewMode(v as ViewMode)}
          className="bg-background/50 border border-border/50 rounded-xl p-1"
        >
          <ToggleGroupItem 
            value="calculator" 
            className="px-4 py-2 data-[state=on]:bg-cyan-500/20 data-[state=on]:text-cyan-300 rounded-lg transition-all gap-2"
          >
            <Calculator className="w-4 h-4" />
            <span>Calculator</span>
          </ToggleGroupItem>
          <ToggleGroupItem 
            value="auto" 
            className="px-4 py-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary rounded-lg transition-all gap-2"
          >
            <Database className="w-4 h-4" />
            <span>Auto Picks</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Calculator Mode */}
      {viewMode === "calculator" && <MedianEdgeCalculator />}

      {/* Auto Mode - Show Paywall if no access */}
      {viewMode === "auto" && !hasAutoPicksAccess && !isUserLoading && (
        <AutoPicksPaywall />
      )}

      {/* Auto Mode - Show Content if has access */}
      {viewMode === "auto" && hasAutoPicksAccess && (
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-card/90 via-card/70 to-primary/10 backdrop-blur-sm">
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/10 rounded-full blur-3xl" />
          
          <div className="relative p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/20 border border-primary/30">
                  <Activity className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Auto-Generated Picks</h3>
                  <p className="text-xs text-muted-foreground">AI-analyzed median edge picks</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating || isFetching}
                  variant="default"
                  size="sm"
                  className="gap-2"
                >
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {picks?.length ? 'Regenerate' : 'Generate'}
                </Button>
                <Button
                  onClick={handleRefresh}
                  disabled={isFetching || isGenerating}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Refresh
                </Button>
              </div>
            </div>

            {/* Loading State */}
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            )}

            {/* Empty State - Show Generate Button */}
            {!isLoading && (!picks || picks.length === 0) && (
              <div className="text-center py-12">
                <Database className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground">No auto picks available today.</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">Click below to generate AI-analyzed picks.</p>
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate Picks
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Picks List */}
            {!isLoading && picks && picks.length > 0 && (
              <div className="space-y-4">
                {/* Stats Summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                    <p className="text-2xl font-bold text-emerald-400">{strongPicks.length}</p>
                    <p className="text-xs text-muted-foreground">Strong Picks</p>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                    <p className="text-2xl font-bold text-amber-400">{leanPicks.length}</p>
                    <p className="text-xs text-muted-foreground">Lean Picks</p>
                  </div>
                </div>

                {/* Strong Picks */}
                {strongPicks.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      Strong Picks
                    </h4>
                    {strongPicks.map((pick) => (
                      <PickCard key={pick.id} pick={pick} />
                    ))}
                  </div>
                )}

                {/* Lean Picks */}
                {leanPicks.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
                      <TrendingDown className="w-4 h-4" />
                      Lean Picks
                    </h4>
                    {leanPicks.map((pick) => (
                      <PickCard key={pick.id} pick={pick} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PickCard({ pick }: { pick: MedianEdgePick }) {
  const [expanded, setExpanded] = useState(false);
  
  const isOver = pick.recommendation.includes('OVER');
  const isStrong = pick.recommendation.includes('STRONG');
  
  const colorClasses = isOver
    ? isStrong ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-emerald-500/30 bg-emerald-500/5'
    : isStrong ? 'border-red-500/50 bg-red-500/10' : 'border-red-500/30 bg-red-500/5';
  
  const textColor = isOver ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className={`rounded-xl border ${colorClasses} overflow-hidden transition-all`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{pick.player_name}</span>
            <span className="text-xs text-muted-foreground capitalize">{pick.stat_type}</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm">
              Line: <span className="font-mono">{pick.sportsbook_line}</span>
            </span>
            <span className="text-sm">
              Median: <span className="font-mono text-cyan-400">{pick.true_median}</span>
            </span>
            <span className={`text-sm font-semibold ${textColor}`}>
              {pick.edge > 0 ? '+' : ''}{pick.edge}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${colorClasses} ${textColor}`}>
            {pick.recommendation}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>
      
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/20">
          <p className="text-sm text-muted-foreground">{pick.reason_summary}</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="text-center p-2 rounded-lg bg-background/30">
              <p className="text-muted-foreground">Form</p>
              <p className="font-mono">{pick.m1_recent_form?.toFixed(1) || '-'}</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-background/30">
              <p className="text-muted-foreground">Matchup</p>
              <p className="font-mono">{pick.m2_matchup?.toFixed(1) || '-'}</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-background/30">
              <p className="text-muted-foreground">Minutes</p>
              <p className="font-mono">{pick.m3_minutes_weighted?.toFixed(1) || '-'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MedianEdgePicksCard;
