import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  RefreshCw, 
  Shield, 
  Target, 
  TrendingUp, 
  TrendingDown,
  Clock,
  Zap
} from "lucide-react";
import { toast } from "sonner";
import { PlayerRoleBadge } from "@/components/parlay/PlayerRoleBadge";

interface RiskEnginePick {
  id: string;
  player_name: string;
  team_name: string | null;
  opponent: string | null;
  prop_type: string;
  line: number;
  side: string;
  player_role: string;
  game_script: string;
  minutes_class: string;
  avg_minutes: number | null;
  confidence_score: number;
  confidence_factors: Record<string, number> | null;
  edge: number | null;
  true_median: number | null;
  reason: string | null;
  outcome: string | null;
}

// Game script indicator
function GameScriptBadge({ script }: { script: string }) {
  const scriptConfig: Record<string, { color: string; label: string }> = {
    'COMPETITIVE': { color: 'bg-green-500/20 text-green-400', label: 'Competitive' },
    'SOFT_BLOWOUT': { color: 'bg-yellow-500/20 text-yellow-400', label: 'Soft Blowout' },
    'HARD_BLOWOUT': { color: 'bg-red-500/20 text-red-400', label: 'Hard Blowout' },
  };
  
  const config = scriptConfig[script] || scriptConfig['COMPETITIVE'];
  
  return (
    <Badge variant="outline" className={`${config.color} text-xs`}>
      {config.label}
    </Badge>
  );
}

// Minutes confidence meter
function MinutesMeter({ minutesClass, avgMinutes }: { minutesClass: string; avgMinutes: number }) {
  const meterConfig: Record<string, { width: string; color: string }> = {
    'LOCKED': { width: 'w-full', color: 'bg-green-500' },
    'MEDIUM': { width: 'w-2/3', color: 'bg-yellow-500' },
    'RISKY': { width: 'w-1/3', color: 'bg-red-500' },
  };
  
  const config = meterConfig[minutesClass] || meterConfig['MEDIUM'];
  
  return (
    <div className="flex items-center gap-2">
      <Clock className="w-3 h-3 text-muted-foreground" />
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${config.width} ${config.color} rounded-full`} />
      </div>
      <span className="text-xs text-muted-foreground">{avgMinutes?.toFixed(0)}m</span>
    </div>
  );
}

// Confidence score display
function ConfidenceScore({ score }: { score: number }) {
  const getColor = () => {
    if (score >= 8.5) return 'text-green-400';
    if (score >= 8.0) return 'text-emerald-400';
    if (score >= 7.7) return 'text-yellow-400';
    return 'text-muted-foreground';
  };
  
  return (
    <div className="flex items-center gap-1">
      <Target className="w-4 h-4 text-muted-foreground" />
      <span className={`font-bold ${getColor()}`}>{score.toFixed(1)}</span>
      <span className="text-xs text-muted-foreground">/10</span>
    </div>
  );
}

// Format prop type for display
function formatPropType(propType: string): string {
  return propType
    .replace('player_', '')
    .replace(/_/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Single pick card
function PickCard({ pick }: { pick: RiskEnginePick }) {
  const isOver = pick.side === 'over';
  
  return (
    <div className="p-4 bg-card/50 rounded-lg border border-border/50 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-semibold text-foreground">{pick.player_name}</h4>
          <p className="text-xs text-muted-foreground">
            {pick.team_name} vs {pick.opponent}
          </p>
        </div>
        <ConfidenceScore score={pick.confidence_score} />
      </div>
      
      {/* Prop details */}
      <div className="flex items-center gap-2">
        <Badge 
          variant="outline" 
          className={isOver 
            ? 'bg-green-500/20 text-green-400 border-green-500/30' 
            : 'bg-red-500/20 text-red-400 border-red-500/30'
          }
        >
          {isOver ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
          {pick.side.toUpperCase()} {pick.line}
        </Badge>
        <span className="text-sm text-foreground">{formatPropType(pick.prop_type)}</span>
      </div>
      
      {/* Classifications */}
      <div className="flex flex-wrap gap-2">
        <PlayerRoleBadge role={pick.player_role} />
        <GameScriptBadge script={pick.game_script} />
      </div>
      
      {/* Minutes meter */}
      <MinutesMeter minutesClass={pick.minutes_class} avgMinutes={pick.avg_minutes} />
      
      {/* Edge & Median */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Median: {pick.true_median?.toFixed(1)} | Edge: {pick.edge > 0 ? '+' : ''}{pick.edge?.toFixed(1)}
        </span>
        {pick.outcome && pick.outcome !== 'pending' && (
          <Badge 
            variant="outline"
            className={pick.outcome === 'hit' 
              ? 'bg-green-500/20 text-green-400' 
              : 'bg-red-500/20 text-red-400'
            }
          >
            {pick.outcome.toUpperCase()}
          </Badge>
        )}
      </div>
      
      {/* Reason */}
      <p className="text-xs text-muted-foreground italic">{pick.reason}</p>
    </div>
  );
}

export function RiskEnginePicksCard() {
  const [activeTab, setActiveTab] = useState<'all' | 'daily'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();
  
  const { data: picks, isLoading, error } = useQuery({
    queryKey: ['risk-engine-picks', activeTab],
    queryFn: async () => {
      let query = supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .order('game_date', { ascending: false })
        .order('confidence_score', { ascending: false });
      
      if (activeTab === 'daily') {
        query = query.gte('confidence_score', 8.2).limit(3);
      } else {
        query = query.gte('confidence_score', 7.5).limit(20);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return (data || []) as unknown as RiskEnginePick[];
    },
    refetchInterval: 60000, // Refresh every minute
  });
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('nba-player-prop-risk-engine', {
        body: { 
          action: 'analyze_slate',
          mode: activeTab === 'daily' ? 'daily_hitter' : 'full_slate'
        }
      });
      
      if (error) throw error;
      
      toast.success(`Risk Engine: ${data.approvedCount} picks approved`);
      queryClient.invalidateQueries({ queryKey: ['risk-engine-picks'] });
    } catch (err) {
      console.error('Risk engine error:', err);
      toast.error('Failed to refresh risk engine');
    } finally {
      setIsRefreshing(false);
    }
  };
  
  return (
    <Card className="bg-card/80 backdrop-blur border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Risk Engine</CardTitle>
              <p className="text-xs text-muted-foreground">8-Step NBA Prop Analysis</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'all' | 'daily')}>
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">
              <Target className="w-4 h-4 mr-2" />
              All Picks
            </TabsTrigger>
            <TabsTrigger value="daily" className="flex-1">
              <Zap className="w-4 h-4 mr-2" />
              Daily Hitters
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="all" className="mt-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                Loading picks...
              </div>
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                Error loading picks
              </div>
            ) : !picks?.length ? (
              <div className="text-center py-8">
                <Shield className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No picks for today</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-3"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                >
                  Run Analysis
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {picks.map((pick) => (
                  <PickCard key={pick.id} pick={pick} />
                ))}
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="daily" className="mt-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                Loading daily hitters...
              </div>
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                Error loading picks
              </div>
            ) : !picks?.length ? (
              <div className="text-center py-8">
                <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No elite picks (8.2+) today</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Daily Hitters require confidence ≥ 8.2
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-medium text-foreground">
                    Elite Picks ({picks.length}/3)
                  </span>
                </div>
                {picks.map((pick) => (
                  <PickCard key={pick.id} pick={pick} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
        
        {/* Legend */}
        <div className="pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground mb-2">Confidence Tiers:</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="text-green-400">8.5+ Elite</span>
            <span className="text-muted-foreground">•</span>
            <span className="text-emerald-400">8.0-8.4 Strong</span>
            <span className="text-muted-foreground">•</span>
            <span className="text-yellow-400">7.7-7.9 Playable</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
