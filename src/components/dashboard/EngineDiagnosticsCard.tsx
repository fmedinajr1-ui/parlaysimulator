import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle, AlertTriangle, XCircle, RefreshCw, Database } from "lucide-react";
import { useState } from "react";

interface DiagnosticResult {
  label: string;
  count: number;
  status: 'healthy' | 'warning' | 'error';
  detail?: string;
}

export function EngineDiagnosticsCard() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: diagnostics, refetch, isLoading } = useQuery({
    queryKey: ['engine-diagnostics'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();

      // Fetch multiple diagnostics in parallel
      const [
        propsResult,
        riskPicksResult,
        propV2Result,
        sharpParlaysResult,
        heatParlaysResult,
        gameLogsResult,
        matchupIntelResult,
        archetypesResult,
        categoryResult,
        envValidationResult
      ] = await Promise.all([
        // Unified props - check for upcoming games
        supabase
          .from('unified_props')
          .select('id, prop_type, commence_time', { count: 'exact' })
          .gt('commence_time', now.toISOString()),
        
        // Risk engine picks for today
        supabase
          .from('nba_risk_engine_picks')
          .select('id, prop_type, player_role, side, rejection_reason, archetype')
          .eq('game_date', today),
        
        // Prop Engine v2 picks
        supabase
          .from('prop_engine_v2_picks')
          .select('id, prop_type, decision')
          .eq('game_date', today),
        
        // Sharp AI parlays
        supabase
          .from('sharp_ai_parlays')
          .select('id, parlay_type, legs')
          .eq('parlay_date', today),
        
        // Heat parlays
        supabase
          .from('heat_parlays')
          .select('id, parlay_type, legs')
          .eq('parlay_date', today),
        
        // Game logs freshness
        supabase
          .from('nba_player_game_logs')
          .select('id', { count: 'exact', head: true })
          .gte('game_date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]),
        
        // v3.0: Matchup intelligence blocking stats
        supabase
          .from('matchup_intelligence')
          .select('id, is_blocked, block_reason')
          .eq('game_date', today),
        
        // v3.0: Player archetypes for distribution
        supabase
          .from('player_archetypes')
          .select('primary_archetype'),
        
        // v3.0: Category sweet spots for alignment check
        supabase
          .from('category_sweet_spots')
          .select('id, recommended_side, l10_hit_rate')
          .gte('l10_hit_rate', 0.7),
          
        // v3.1: Game Environment Validation results
        supabase
          .from('game_environment_validation')
          .select('validation_status')
          .eq('game_date', today)
      ]);

      // Process unified props by type
      const propsByType: Record<string, number> = {};
      (propsResult.data || []).forEach((p: any) => {
        const type = p.prop_type?.toLowerCase() || 'unknown';
        let category = 'other';
        if (type.includes('rebound')) category = 'rebounds';
        else if (type.includes('assist')) category = 'assists';
        else if (type.includes('point') && !type.includes('rebound') && !type.includes('assist')) category = 'points';
        else if (type.includes('three') || type.includes('3pt')) category = 'threes';
        else if (type.includes('block')) category = 'blocks';
        else if (type.includes('steal')) category = 'steals';
        propsByType[category] = (propsByType[category] || 0) + 1;
      });

      // Process risk picks by approval/rejection
      const riskPicks = riskPicksResult.data || [];
      const approvedPicks = riskPicks.filter((p: any) => !p.rejection_reason);
      const rejectedPicks = riskPicks.filter((p: any) => p.rejection_reason);
      
      // Approved by type
      const approvedByType: Record<string, number> = {};
      approvedPicks.forEach((p: any) => {
        const type = p.prop_type?.toLowerCase() || 'unknown';
        let category = 'other';
        if (type.includes('rebound')) category = 'rebounds';
        else if (type.includes('assist')) category = 'assists';
        else if (type.includes('point') && !type.includes('rebound') && !type.includes('assist')) category = 'points';
        else if (type.includes('three') || type.includes('3pt')) category = 'threes';
        approvedByType[category] = (approvedByType[category] || 0) + 1;
      });

      // Prop v2 decisions
      const propV2Picks = propV2Result.data || [];
      const propV2Bets = propV2Picks.filter((p: any) => p.decision === 'BET').length;
      const propV2Leans = propV2Picks.filter((p: any) => p.decision === 'LEAN').length;

      // Parlays
      const sharpParlays = sharpParlaysResult.data || [];
      const heatParlays = heatParlaysResult.data || [];
      
      // v3.0 Stats
      const matchupData = matchupIntelResult.data || [];
      const blockedByMatchup = matchupData.filter((m: any) => m.is_blocked).length;
      const matchupTotal = matchupData.length;
      
      // Archetype distribution
      const archetypeData = archetypesResult.data || [];
      const archetypeDistribution: Record<string, number> = {};
      archetypeData.forEach((a: any) => {
        const arch = a.primary_archetype || 'UNKNOWN';
        archetypeDistribution[arch] = (archetypeDistribution[arch] || 0) + 1;
      });
      
      // Category recommendations
      const categoryData = categoryResult.data || [];
      
      // v3.1: Game Environment Validation stats
      const envData = envValidationResult.data || [];
      const envApproved = envData.filter((v: any) => v.validation_status === 'APPROVED').length;
      const envConditional = envData.filter((v: any) => v.validation_status === 'CONDITIONAL').length;
      const envRejected = envData.filter((v: any) => v.validation_status === 'REJECTED').length;

      return {
        dataFreshness: {
          upcomingProps: propsResult.data?.length || 0,
          gameLogsWeek: gameLogsResult.count || 0,
          lastUpdated: new Date().toISOString()
        },
        propDistribution: propsByType,
        riskEngine: {
          total: riskPicks.length,
          approved: approvedPicks.length,
          rejected: rejectedPicks.length,
          approvedByType
        },
        propEngineV2: {
          total: propV2Picks.length,
          bets: propV2Bets,
          leans: propV2Leans,
          passes: propV2Picks.length - propV2Bets - propV2Leans
        },
        parlays: {
          sharpTotal: sharpParlays.length,
          sharpTypes: sharpParlays.map((p: any) => p.parlay_type),
          heatTotal: heatParlays.length,
          heatTypes: heatParlays.map((p: any) => p.parlay_type)
        },
        v3Rules: {
          matchupBlocked: blockedByMatchup,
          matchupTotal: matchupTotal,
          categoryRecsCount: categoryData.length,
          archetypeDistribution,
          envApproved,
          envConditional,
          envRejected
        }
      };
    },
    refetchInterval: 60000 // Refresh every minute
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const getStatusIcon = (status: 'healthy' | 'warning' | 'error') => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getHealthStatus = (value: number, warningThreshold: number, errorThreshold: number): 'healthy' | 'warning' | 'error' => {
    if (value >= warningThreshold) return 'healthy';
    if (value >= errorThreshold) return 'warning';
    return 'error';
  };

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Engine Diagnostics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-1/2" />
            <div className="h-4 bg-muted rounded w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Engine Diagnostics
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Data Freshness */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Data Freshness</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              {getStatusIcon(getHealthStatus(diagnostics?.dataFreshness.upcomingProps || 0, 10, 1))}
              <span className="text-sm">
                {diagnostics?.dataFreshness.upcomingProps || 0} upcoming props
              </span>
            </div>
            <div className="flex items-center gap-2">
              {getStatusIcon(getHealthStatus(diagnostics?.dataFreshness.gameLogsWeek || 0, 100, 10))}
              <span className="text-sm">
                {diagnostics?.dataFreshness.gameLogsWeek || 0} game logs (7d)
              </span>
            </div>
          </div>
        </div>

        {/* Prop Distribution */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Prop Distribution (Upcoming)</h4>
          <div className="flex flex-wrap gap-1">
            {Object.entries(diagnostics?.propDistribution || {}).map(([type, count]) => (
              <Badge 
                key={type} 
                variant={type === 'rebounds' || type === 'assists' ? 'default' : 'secondary'}
                className="text-xs"
              >
                {type}: {count as number}
              </Badge>
            ))}
            {Object.keys(diagnostics?.propDistribution || {}).length === 0 && (
              <span className="text-sm text-muted-foreground">No upcoming props</span>
            )}
          </div>
        </div>

        {/* Risk Engine */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Risk Engine (Today)</h4>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-green-500">{diagnostics?.riskEngine.approved || 0} approved</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-red-400">{diagnostics?.riskEngine.rejected || 0} rejected</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(diagnostics?.riskEngine.approvedByType || {}).map(([type, count]) => (
              <Badge key={type} variant="outline" className="text-xs">
                {type}: {count as number}
              </Badge>
            ))}
          </div>
        </div>

        {/* Prop Engine v2 */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Prop Engine v2 (Today)</h4>
          <div className="flex items-center gap-3 text-sm">
            <Badge variant="default" className="bg-green-600">{diagnostics?.propEngineV2.bets || 0} BET</Badge>
            <Badge variant="secondary">{diagnostics?.propEngineV2.leans || 0} LEAN</Badge>
            <Badge variant="outline">{diagnostics?.propEngineV2.passes || 0} PASS</Badge>
          </div>
        </div>

        {/* Parlays */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Parlays Built (Today)</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Sharp AI:</span>{' '}
              <span className="font-medium">{diagnostics?.parlays.sharpTotal || 0}</span>
              {diagnostics?.parlays.sharpTypes?.length > 0 && (
                <span className="text-xs text-muted-foreground ml-1">
                  ({diagnostics.parlays.sharpTypes.join(', ')})
                </span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Heat:</span>{' '}
              <span className="font-medium">{diagnostics?.parlays.heatTotal || 0}</span>
              {diagnostics?.parlays.heatTypes?.length > 0 && (
                <span className="text-xs text-muted-foreground ml-1">
                  ({diagnostics.parlays.heatTypes.join(', ')})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* v3.0 Rules Stats */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">v3.1 Rules Enforcement</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              {getStatusIcon(diagnostics?.v3Rules?.matchupBlocked === 0 ? 'healthy' : 'warning')}
              <span>
                🚫 {diagnostics?.v3Rules?.matchupBlocked || 0} matchup blocked
              </span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-primary" />
              <span>
                📊 {diagnostics?.v3Rules?.categoryRecsCount || 0} category recs
              </span>
            </div>
          </div>
          {/* Game Environment Validation */}
          <div className="flex items-center gap-3 mt-2 text-sm">
            <span className="text-green-500">🟢 {diagnostics?.v3Rules?.envApproved || 0}</span>
            <span className="text-yellow-500">🟡 {diagnostics?.v3Rules?.envConditional || 0}</span>
            <span className="text-red-400">🔴 {diagnostics?.v3Rules?.envRejected || 0}</span>
            <span className="text-muted-foreground text-xs">(Vegas Validator)</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(diagnostics?.v3Rules?.archetypeDistribution || {}).slice(0, 5).map(([arch, count]) => (
              <Badge key={arch} variant="outline" className="text-xs">
                {arch}: {count as number}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
