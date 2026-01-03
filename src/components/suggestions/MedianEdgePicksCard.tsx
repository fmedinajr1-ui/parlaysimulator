import { useState } from "react";
import { Calculator, Database, ChevronDown, ChevronUp, RefreshCw, Activity, TrendingUp, TrendingDown, Loader2, Sparkles, Shield, Zap, Target, Users, Layers, Trophy, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { MedianEdgeCalculator } from "./MedianEdgeCalculator";
import { AutoPicksPaywall } from "./AutoPicksPaywall";
import { usePilotUser } from "@/hooks/usePilotUser";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ViewMode = "calculator" | "auto" | "parlays";

interface MedianEdgePick {
  id: string;
  player_name: string;
  stat_type: string;
  sportsbook_line: number;
  true_median: number;
  edge: number;
  recommendation: string;
  confidence_flag: string;
  m1_recent_form?: number;
  m2_matchup?: number;
  m3_minutes_weighted?: number;
  adjustments?: Record<string, number>;
  reason_summary: string;
  created_at: string;
  adjusted_median?: number;
  defense_code?: number;
  defense_multiplier?: number;
  hit_rate_over_10?: number;
  hit_rate_under_10?: number;
  median5?: number;
  volatility?: number;
  confidence_tier?: 'A' | 'B' | 'C' | 'D';
  engine_version?: string;
}

interface ParlayLeg {
  player_name: string;
  stat_type: string;
  line: number;
  edge: number;
  recommendation: string;
  confidence_tier: string;
  hit_rate: number;
  volatility: number;
  defense_code: number | null;
  is_duo: boolean;
  pick_score: number;
}

interface GeneratedParlay {
  id?: string;
  parlay_type: string;
  legs: ParlayLeg[];
  total_edge: number;
  combined_hit_rate: number;
  confidence_score: number;
  stat_breakdown: Record<string, number>;
  duo_stacks: { player: string; type: string; boost: number }[];
  defense_advantage_score: number;
  outcome?: string;
  legs_won?: number;
  legs_lost?: number;
}

interface DuoOpportunity {
  player: string;
  stats: string[];
  direction: "OVER" | "UNDER";
  combined_edge: number;
  avg_hit_rate: number;
  boost: number;
  confidence: "ELITE" | "STRONG" | "MODERATE";
}

// Confidence Tier Badge Component
function ConfidenceTierBadge({ tier }: { tier?: string }) {
  const config = {
    A: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/50', text: 'text-emerald-400', label: 'Elite' },
    B: { bg: 'bg-cyan-500/20', border: 'border-cyan-500/50', text: 'text-cyan-400', label: 'Strong' },
    C: { bg: 'bg-amber-500/20', border: 'border-amber-500/50', text: 'text-amber-400', label: 'Lean' },
    D: { bg: 'bg-muted/20', border: 'border-muted/50', text: 'text-muted-foreground', label: 'Low' },
  };
  
  const t = (tier as keyof typeof config) || 'D';
  const c = config[t];
  
  return (
    <div className={`px-2 py-0.5 rounded-md text-xs font-bold ${c.bg} ${c.border} ${c.text} border flex items-center gap-1`}>
      <span className="text-[10px]">{t}</span>
      <span className="hidden sm:inline">{c.label}</span>
    </div>
  );
}

// Hit Rate Progress Bar Component
function HitRateBar({ rate, direction }: { rate: number; direction: 'over' | 'under' }) {
  const percentage = Math.round(rate * 100);
  const color = percentage >= 70 ? 'bg-emerald-500' : percentage >= 60 ? 'bg-amber-500' : 'bg-red-500';
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 flex-1">
            <div className="flex-1 h-2 bg-background/50 rounded-full overflow-hidden">
              <div 
                className={`h-full ${color} transition-all duration-300`} 
                style={{ width: `${percentage}%` }}
              />
            </div>
            <span className={`text-xs font-mono font-semibold ${percentage >= 70 ? 'text-emerald-400' : percentage >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
              {percentage}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Hit rate {direction.toUpperCase()} last 10 games</p>
          <p className="text-xs text-muted-foreground">70%+ = Strong, 60%+ = Lean</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Defense Code Indicator
function DefenseCodeIndicator({ code, multiplier }: { code?: number; multiplier?: number }) {
  if (code === undefined || code === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  
  const isHard = code >= 60;
  const isSoft = code < 40;
  const color = isHard ? 'text-red-400' : isSoft ? 'text-emerald-400' : 'text-amber-400';
  const bgColor = isHard ? 'bg-red-500/10' : isSoft ? 'bg-emerald-500/10' : 'bg-amber-500/10';
  const label = isHard ? 'Hard' : isSoft ? 'Soft' : 'Neutral';
  const multStr = multiplier ? `${multiplier > 0 ? '+' : ''}${(multiplier * 100).toFixed(0)}%` : '';
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${bgColor}`}>
            <Shield className={`w-3 h-3 ${color}`} />
            <span className={`text-xs font-semibold ${color}`}>{code}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="font-semibold">{label} Defense</p>
          <p className="text-xs text-muted-foreground">
            Code {code}/100 → {multStr} adjustment
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Higher code = harder to score against
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Volatility Indicator
function VolatilityIndicator({ volatility }: { volatility?: number }) {
  if (volatility === undefined || volatility === null) return null;
  
  const isLow = volatility < 0.25;
  const isHigh = volatility > 0.35;
  const color = isLow ? 'text-emerald-400 bg-emerald-500/10' : isHigh ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10';
  const label = isLow ? 'LOW' : isHigh ? 'HIGH' : 'MED';
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${color}`}>
            <Zap className="w-3 h-3" />
            <span className="text-xs font-semibold">{label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Volatility: {(volatility * 100).toFixed(0)}%</p>
          <p className="text-xs text-muted-foreground">
            {isLow ? 'Consistent performer' : isHigh ? 'High variance - unpredictable' : 'Moderate consistency'}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Duo Stack Badge Component
function DuoStackBadge({ duo }: { duo: { player: string; type: string; boost: number } }) {
  const typeLabel = duo.type.includes('+') ? duo.type : duo.type.toUpperCase();
  
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30">
      <Users className="w-3 h-3 text-purple-400" />
      <span className="text-xs font-semibold text-purple-300">{duo.player}</span>
      <span className="text-xs text-purple-400/70">{typeLabel}</span>
      <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/30 text-purple-300 font-bold">+{duo.boost}%</span>
    </div>
  );
}

// Parlay Type Badge
function ParlayTypeBadge({ type, confidence }: { type: string; confidence: number }) {
  const config = {
    SAFE: { bg: 'from-emerald-500/20 to-emerald-600/10', border: 'border-emerald-500/40', text: 'text-emerald-400', icon: Shield },
    BALANCED: { bg: 'from-cyan-500/20 to-cyan-600/10', border: 'border-cyan-500/40', text: 'text-cyan-400', icon: Layers },
    VALUE: { bg: 'from-amber-500/20 to-amber-600/10', border: 'border-amber-500/40', text: 'text-amber-400', icon: Trophy },
  };
  
  const c = config[type as keyof typeof config] || config.BALANCED;
  const Icon = c.icon;
  
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r ${c.bg} border ${c.border}`}>
      <Icon className={`w-4 h-4 ${c.text}`} />
      <span className={`font-bold ${c.text}`}>{type}</span>
      <div className={`px-2 py-0.5 rounded-md bg-background/30 ${c.text} text-xs font-semibold`}>
        {confidence.toFixed(0)}%
      </div>
    </div>
  );
}

// Duo Opportunity Card
function DuoOpportunityCard({ duo }: { duo: DuoOpportunity }) {
  const confidenceColors = {
    ELITE: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/40 text-emerald-400',
    STRONG: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/40 text-cyan-400',
    MODERATE: 'from-amber-500/20 to-amber-600/10 border-amber-500/40 text-amber-400',
  };
  
  const colors = confidenceColors[duo.confidence];
  const directionColor = duo.direction === 'OVER' ? 'text-emerald-400' : 'text-red-400';
  
  return (
    <div className={`p-3 rounded-xl bg-gradient-to-r ${colors} border`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" />
          <span className="font-semibold">{duo.player}</span>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-md bg-background/30 ${directionColor}`}>
          {duo.direction}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {duo.stats.map((stat, i) => (
          <span key={i} className="text-xs px-2 py-0.5 rounded bg-background/30 capitalize">{stat}</span>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 text-xs">
        <span>Edge: <span className="font-mono font-semibold">+{duo.combined_edge.toFixed(1)}</span></span>
        <span>Hit: <span className="font-mono font-semibold">{(duo.avg_hit_rate * 100).toFixed(0)}%</span></span>
        <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold">+{duo.boost}%</span>
      </div>
    </div>
  );
}

// Parlay Card Component
function ParlayCard({ parlay }: { parlay: GeneratedParlay }) {
  const [expanded, setExpanded] = useState(false);
  
  const outcomeColors = {
    won: 'border-emerald-500/50 bg-emerald-500/10',
    lost: 'border-red-500/50 bg-red-500/10',
    pending: 'border-border/50 bg-card/50',
    partial: 'border-amber-500/50 bg-amber-500/10',
  };
  
  const borderColor = outcomeColors[parlay.outcome as keyof typeof outcomeColors] || outcomeColors.pending;
  
  return (
    <div className={`rounded-xl border ${borderColor} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left"
      >
        <div className="flex items-center justify-between mb-3">
          <ParlayTypeBadge type={parlay.parlay_type} confidence={parlay.confidence_score} />
          <div className="flex items-center gap-2">
            {parlay.outcome && parlay.outcome !== 'pending' && (
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                parlay.outcome === 'won' ? 'bg-emerald-500/20 text-emerald-400' :
                parlay.outcome === 'lost' ? 'bg-red-500/20 text-red-400' :
                'bg-amber-500/20 text-amber-400'
              }`}>
                {parlay.outcome.toUpperCase()} {parlay.legs_won !== undefined && `(${parlay.legs_won}/${parlay.legs.length})`}
              </span>
            )}
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
        
        {/* Duo Stacks */}
        {parlay.duo_stacks && parlay.duo_stacks.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {parlay.duo_stacks.map((duo, i) => (
              <DuoStackBadge key={i} duo={duo} />
            ))}
          </div>
        )}
        
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-background/30">
            <p className="text-xs text-muted-foreground">Total Edge</p>
            <p className="font-mono font-bold text-cyan-400">+{parlay.total_edge.toFixed(1)}</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-background/30">
            <p className="text-xs text-muted-foreground">Avg Hit Rate</p>
            <p className="font-mono font-bold text-emerald-400">{(parlay.combined_hit_rate * 100).toFixed(0)}%</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-background/30">
            <p className="text-xs text-muted-foreground">Def Advantage</p>
            <p className="font-mono font-bold text-purple-400">{(parlay.defense_advantage_score * 100).toFixed(0)}%</p>
          </div>
        </div>
      </button>
      
      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-border/20 pt-3">
          <p className="text-xs text-muted-foreground mb-2">6 Legs • {Object.keys(parlay.stat_breakdown).length} Stat Types</p>
          {parlay.legs.map((leg, i) => (
            <div key={i} className={`p-2 rounded-lg border ${
              leg.recommendation.includes('OVER') ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {leg.is_duo && <Star className="w-3 h-3 text-purple-400" />}
                  <ConfidenceTierBadge tier={leg.confidence_tier} />
                  <span className="font-semibold text-sm">{leg.player_name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{leg.stat_type}</span>
                </div>
                <span className={`text-xs font-semibold ${
                  leg.recommendation.includes('OVER') ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {leg.recommendation}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>Line: <span className="font-mono">{leg.line}</span></span>
                <span>Edge: <span className="font-mono text-cyan-400">{leg.edge > 0 ? '+' : ''}{leg.edge.toFixed(1)}</span></span>
                <span>Hit: <span className="font-mono">{(leg.hit_rate * 100).toFixed(0)}%</span></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MedianEdgePicksCard() {
  const [viewMode, setViewMode] = useState<ViewMode>("calculator");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingParlays, setIsGeneratingParlays] = useState(false);
  const { toast } = useToast();
  const { isAdmin, isSubscribed, isLoading: isUserLoading } = usePilotUser();
  
  const hasAutoPicksAccess = isAdmin || isSubscribed;
  
  // Picks query
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

  // Parlays query
  const { data: parlaysData, isLoading: isParlaysLoading, refetch: refetchParlays, isFetching: isParlaysFetching } = useQuery({
    queryKey: ['median-parlays'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('nba-median-matchup-engine', {
        body: { action: 'get_parlays' }
      });
      
      if (error) throw error;
      return data as { parlays: GeneratedParlay[]; duo_opportunities: DuoOpportunity[] };
    },
    enabled: viewMode === "parlays"
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
      const { data, error } = await supabase.functions.invoke('nba-median-matchup-engine', {
        body: { action: 'analyze_auto' }
      });
      
      if (error) throw error;
      
      toast({
        title: "V2 Picks Generated",
        description: `Found ${data?.actionable_picks || 0} actionable picks (Tier A: ${data?.tier_breakdown?.A || 0}, B: ${data?.tier_breakdown?.B || 0}, C: ${data?.tier_breakdown?.C || 0})`
      });
      
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

  const handleGenerateParlays = async () => {
    setIsGeneratingParlays(true);
    try {
      const { data, error } = await supabase.functions.invoke('nba-median-matchup-engine', {
        body: { action: 'generate_parlays' }
      });
      
      if (error) throw error;
      
      const parlayCounts = [
        data?.parlays?.SAFE ? 'SAFE' : null,
        data?.parlays?.BALANCED ? 'BALANCED' : null,
        data?.parlays?.VALUE ? 'VALUE' : null,
      ].filter(Boolean).join(', ');
      
      toast({
        title: "AI Parlays Generated",
        description: `Created ${data?.summary?.parlays_generated || 0} parlays (${parlayCounts || 'none'}) with ${data?.summary?.duo_stacks_found || 0} duo stacks detected`
      });
      
      await refetchParlays();
    } catch (error: any) {
      console.error('Parlay generation error:', error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate parlays",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingParlays(false);
    }
  };

  const strongPicks = picks?.filter(p => p.recommendation.includes('STRONG')) || [];
  const leanPicks = picks?.filter(p => p.recommendation.includes('LEAN')) || [];
  
  const tierA = picks?.filter(p => p.confidence_tier === 'A') || [];
  const tierB = picks?.filter(p => p.confidence_tier === 'B') || [];
  const tierC = picks?.filter(p => p.confidence_tier === 'C') || [];
  const isV2 = picks?.some(p => p.engine_version === 'v2');

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
            className="px-3 py-2 data-[state=on]:bg-cyan-500/20 data-[state=on]:text-cyan-300 rounded-lg transition-all gap-2"
          >
            <Calculator className="w-4 h-4" />
            <span className="hidden sm:inline">Calculator</span>
          </ToggleGroupItem>
          <ToggleGroupItem 
            value="auto" 
            className="px-3 py-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary rounded-lg transition-all gap-2"
          >
            <Database className="w-4 h-4" />
            <span className="hidden sm:inline">Auto Picks</span>
          </ToggleGroupItem>
          <ToggleGroupItem 
            value="parlays" 
            className="px-3 py-2 data-[state=on]:bg-purple-500/20 data-[state=on]:text-purple-300 rounded-lg transition-all gap-2"
          >
            <Layers className="w-4 h-4" />
            <span className="hidden sm:inline">AI Parlays</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {viewMode === "calculator" && <MedianEdgeCalculator />}

      {viewMode === "auto" && !hasAutoPicksAccess && !isUserLoading && (
        <AutoPicksPaywall />
      )}

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
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    NBA Median Engine
                    {isV2 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">v2</span>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground">Defense matchups + hit rate validation</p>
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
                </Button>
              </div>
            </div>

            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            )}

            {!isLoading && (!picks || picks.length === 0) && (
              <div className="text-center py-12">
                <Database className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground">No auto picks available today.</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">Click below to generate AI-analyzed picks.</p>
                <Button onClick={handleGenerate} disabled={isGenerating} className="gap-2">
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

            {!isLoading && picks && picks.length > 0 && (
              <div className="space-y-4">
                {isV2 ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                      <p className="text-2xl font-bold text-emerald-400">{tierA.length}</p>
                      <p className="text-xs text-muted-foreground">Tier A (Elite)</p>
                    </div>
                    <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-center">
                      <p className="text-2xl font-bold text-cyan-400">{tierB.length}</p>
                      <p className="text-xs text-muted-foreground">Tier B (Strong)</p>
                    </div>
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                      <p className="text-2xl font-bold text-amber-400">{tierC.length}</p>
                      <p className="text-xs text-muted-foreground">Tier C (Lean)</p>
                    </div>
                  </div>
                ) : (
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
                )}

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

      {/* AI Parlays View */}
      {viewMode === "parlays" && !hasAutoPicksAccess && !isUserLoading && (
        <AutoPicksPaywall />
      )}

      {viewMode === "parlays" && hasAutoPicksAccess && (
        <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-card/90 via-card/70 to-purple-500/10 backdrop-blur-sm">
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl" />
          
          <div className="relative p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-500/20 border border-purple-500/30">
                  <Layers className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    AI Parlay Builder
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">v1</span>
                  </h3>
                  <p className="text-xs text-muted-foreground">6-leg parlays with duo stack detection</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleGenerateParlays}
                  disabled={isGeneratingParlays || isParlaysFetching}
                  variant="default"
                  size="sm"
                  className="gap-2 bg-purple-600 hover:bg-purple-700"
                >
                  {isGeneratingParlays ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {parlaysData?.parlays?.length ? 'Regenerate' : 'Generate'}
                </Button>
                <Button
                  onClick={() => refetchParlays()}
                  disabled={isParlaysFetching || isGeneratingParlays}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  {isParlaysFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {isParlaysLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
              </div>
            )}

            {!isParlaysLoading && (!parlaysData?.parlays || parlaysData.parlays.length === 0) && (
              <div className="text-center py-12">
                <Layers className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground">No AI parlays available today.</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">Generate picks first, then create AI parlays.</p>
                <Button onClick={handleGenerateParlays} disabled={isGeneratingParlays} className="gap-2 bg-purple-600 hover:bg-purple-700">
                  {isGeneratingParlays ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate AI Parlays
                    </>
                  )}
                </Button>
              </div>
            )}

            {!isParlaysLoading && parlaysData?.parlays && parlaysData.parlays.length > 0 && (
              <div className="space-y-4">
                {/* Duo Opportunities */}
                {parlaysData.duo_opportunities && parlaysData.duo_opportunities.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-purple-400 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Duo Stack Opportunities ({parlaysData.duo_opportunities.length})
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {parlaysData.duo_opportunities.slice(0, 4).map((duo, i) => (
                        <DuoOpportunityCard key={i} duo={duo} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Parlays */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-400" />
                    Generated Parlays
                  </h4>
                  {parlaysData.parlays.map((parlay, i) => (
                    <ParlayCard key={parlay.id || i} parlay={parlay} />
                  ))}
                </div>
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
  const isV2 = pick.engine_version === 'v2';
  
  const colorClasses = isOver
    ? isStrong ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-emerald-500/30 bg-emerald-500/5'
    : isStrong ? 'border-red-500/50 bg-red-500/10' : 'border-red-500/30 bg-red-500/5';
  
  const textColor = isOver ? 'text-emerald-400' : 'text-red-400';
  
  const hitRate = isOver ? pick.hit_rate_over_10 : pick.hit_rate_under_10;

  return (
    <div className={`rounded-xl border ${colorClasses} overflow-hidden transition-all`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isV2 && <ConfidenceTierBadge tier={pick.confidence_tier} />}
            <span className="font-semibold truncate">{pick.player_name}</span>
            <span className="text-xs text-muted-foreground capitalize">{pick.stat_type}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm">
              Line: <span className="font-mono">{pick.sportsbook_line}</span>
            </span>
            <span className="text-sm">
              Median: <span className="font-mono text-cyan-400">{pick.true_median}</span>
            </span>
            {isV2 && pick.adjusted_median && (
              <span className="text-sm">
                Adj: <span className="font-mono text-purple-400">{pick.adjusted_median}</span>
              </span>
            )}
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
        <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border/20">
          {isV2 && hitRate !== undefined && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Target className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Hit Rate ({isOver ? 'OVER' : 'UNDER'}):</span>
                <HitRateBar rate={hitRate} direction={isOver ? 'over' : 'under'} />
              </div>
              
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Defense:</span>
                  <DefenseCodeIndicator code={pick.defense_code} multiplier={pick.defense_multiplier} />
                </div>
                {pick.volatility !== undefined && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Volatility:</span>
                    <VolatilityIndicator volatility={pick.volatility} />
                  </div>
                )}
              </div>
            </div>
          )}
          
          <p className="text-sm text-muted-foreground">{pick.reason_summary}</p>
          
          {!isV2 && (
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
          )}
        </div>
      )}
    </div>
  );
}

export default MedianEdgePicksCard;
