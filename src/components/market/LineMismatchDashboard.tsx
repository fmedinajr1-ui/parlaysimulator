import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, TrendingUp, TrendingDown, CheckCircle, XCircle, Loader2, Scale, Target } from "lucide-react";
import { cn } from "@/lib/utils";

// Get today's date in Eastern Time
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Get date N days ago in Eastern Time
function getEasternDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

interface LineMismatchPick {
  id: string;
  player_name: string;
  prop_type: string;
  actual_line: number | null;
  recommended_line: number | null;
  projected_value: number | null;
  recommended_side: string | null;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  confidence_score: number | null;
  category: string;
  outcome: string | null;
  actual_value: number | null;
  analysis_date: string;
}

type SeverityTier = 'ALL' | 'EXTREME' | 'HIGH' | 'MEDIUM' | 'LOW';

function getSeverity(actualLine: number | null, projectedValue: number | null): SeverityTier {
  if (!actualLine || !projectedValue) return 'LOW';
  const diff = Math.abs(actualLine - projectedValue);
  if (diff >= 10) return 'EXTREME';
  if (diff >= 5) return 'HIGH';
  if (diff >= 2) return 'MEDIUM';
  return 'LOW';
}

function getSeverityColor(severity: SeverityTier): string {
  switch (severity) {
    case 'EXTREME': return 'text-red-400 bg-red-500/20 border-red-500/30';
    case 'HIGH': return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
    case 'MEDIUM': return 'text-amber-400 bg-amber-500/20 border-amber-500/30';
    case 'LOW': return 'text-green-400 bg-green-500/20 border-green-500/30';
    default: return 'text-muted-foreground';
  }
}

function getMismatchRisk(pick: LineMismatchPick): 'safe' | 'warning' | 'danger' {
  const projectedValue = pick.projected_value || 0;
  const actualLine = pick.actual_line || 0;
  const diff = actualLine - projectedValue;
  const absDiff = Math.abs(diff);
  
  // STAR_FLOOR_OVER: Book line > projected is EXPECTED (star will score over their floor)
  if (pick.category === 'STAR_FLOOR_OVER' && diff > 0 && pick.recommended_side === 'over') {
    return 'safe';
  }
  
  // LOW_SCORER_UNDER: If book line is LOWER than projected, that's dangerous
  if (pick.category === 'LOW_SCORER_UNDER' && diff < -2) {
    return 'danger'; // Book moved line down - they might know something
  }
  
  // For OVER bets: book line > projected is bad (harder to hit)
  if (pick.recommended_side === 'over' && diff > 3) {
    return 'warning';
  }
  
  // For UNDER bets: book line < projected is bad (more likely to go over)
  if (pick.recommended_side === 'under' && diff < -3) {
    return 'warning';
  }
  
  return absDiff >= 5 ? 'warning' : 'safe';
}

function formatPropType(propType: string): string {
  return propType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function LineMismatchDashboard() {
  const [severityFilter, setSeverityFilter] = useState<SeverityTier>('ALL');
  const [daysBack, setDaysBack] = useState(7);

  const { data: picks, isLoading, error } = useQuery({
    queryKey: ['line-mismatch-audit', daysBack],
    queryFn: async () => {
      const startDate = getEasternDateDaysAgo(daysBack);
      
      const { data, error } = await supabase
        .from('category_sweet_spots')
        .select(`
          id, player_name, prop_type, actual_line, recommended_line, 
          projected_value, recommended_side, l10_hit_rate, l10_avg, confidence_score, 
          category, outcome, actual_value, analysis_date
        `)
        .gte('analysis_date', startDate)
        .not('actual_line', 'is', null)
        .order('analysis_date', { ascending: false });

      if (error) throw error;
      return (data || []) as LineMismatchPick[];
    },
    refetchInterval: 60000,
  });

  // Calculate edge: projected - book line (positive = value for OVER, negative = value for UNDER)
  const withEdge = (picks || []).map(pick => {
    const projected = pick.projected_value || pick.l10_avg || 0;
    const bookLine = pick.actual_line || 0;
    const edge = projected - bookLine;
    const severity = getSeverity(bookLine, projected);
    const risk = getMismatchRisk({ ...pick, projected_value: projected });
    
    return { ...pick, projected, edge, severity, risk };
  });

  // Filter by severity
  const filteredPicks = severityFilter === 'ALL' 
    ? withEdge 
    : withEdge.filter(p => p.severity === severityFilter);

  // Calculate accuracy stats by severity
  const severityStats = ['EXTREME', 'HIGH', 'MEDIUM', 'LOW'].map(tier => {
    const tierPicks = withEdge.filter(p => p.severity === tier && p.outcome);
    const hits = tierPicks.filter(p => p.outcome === 'hit').length;
    const total = tierPicks.filter(p => p.outcome === 'hit' || p.outcome === 'miss').length;
    const hitRate = total > 0 ? (hits / total * 100) : null;
    
    return { tier, hits, total, hitRate, count: withEdge.filter(p => p.severity === tier).length };
  });

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Line Mismatch Audit</CardTitle>
          </div>
          <div className="flex gap-2">
            {[7, 14, 30].map(days => (
              <Button
                key={days}
                variant={daysBack === days ? "default" : "outline"}
                size="sm"
                onClick={() => setDaysBack(days)}
              >
                {days}d
              </Button>
            ))}
          </div>
        </div>
        <CardDescription>
          Comparing projected values vs actual book lines to identify edge and trap lines
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Severity Stats */}
        <div className="grid grid-cols-4 gap-2">
          {severityStats.map(({ tier, hits, total, hitRate, count }) => (
            <button
              key={tier}
              onClick={() => setSeverityFilter(tier === severityFilter ? 'ALL' : tier as SeverityTier)}
              className={cn(
                "p-3 rounded-lg border text-center transition-all",
                getSeverityColor(tier as SeverityTier),
                severityFilter === tier && "ring-2 ring-primary"
              )}
            >
              <p className="text-xs font-medium opacity-80">{tier}</p>
              <p className="text-lg font-bold">{count}</p>
              {hitRate !== null && (
                <p className="text-xs">
                  {hitRate.toFixed(0)}% ({hits}/{total})
                </p>
              )}
            </button>
          ))}
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={severityFilter === 'ALL' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSeverityFilter('ALL')}
          >
            All ({withEdge.length})
          </Button>
          {['EXTREME', 'HIGH', 'MEDIUM', 'LOW'].map(tier => (
            <Button
              key={tier}
              variant={severityFilter === tier ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSeverityFilter(tier as SeverityTier)}
              className={severityFilter === tier ? '' : getSeverityColor(tier as SeverityTier)}
            >
              {tier} ({withEdge.filter(p => p.severity === tier).length})
            </Button>
          ))}
        </div>

        {/* Picks List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">
            <p>Error loading data</p>
          </div>
        ) : filteredPicks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Scale className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No picks found for this filter</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {filteredPicks.slice(0, 50).map((pick) => (
              <div
                key={pick.id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border",
                  "bg-background/50 hover:bg-background/80 transition-colors",
                  pick.risk === 'danger' && "border-red-500/30 bg-red-500/5",
                  pick.risk === 'warning' && "border-amber-500/30 bg-amber-500/5",
                  pick.risk === 'safe' && pick.outcome === 'hit' && "border-green-500/30 bg-green-500/5"
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Risk Indicator */}
                  {pick.risk === 'danger' ? (
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                  ) : pick.risk === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                  ) : pick.edge > 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-400" />
                  )}

                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{pick.player_name}</p>
                      <Badge variant="outline" className={cn("text-[10px]", getSeverityColor(pick.severity))}>
                        {pick.severity}
                      </Badge>
                      {pick.outcome === 'hit' && (
                        <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                      )}
                      {pick.outcome === 'miss' && (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <span>{formatPropType(pick.prop_type)}</span>
                      <span className={pick.recommended_side === 'over' ? 'text-green-400' : 'text-red-400'}>
                        {pick.recommended_side?.toUpperCase()}
                      </span>
                      <span>{pick.actual_line}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-right">
                  {/* Projection vs Book */}
                  <div>
                    <p className="text-xs text-muted-foreground">Proj → Book</p>
                    <p className="text-sm font-mono">
                      <span className="text-primary">{pick.projected.toFixed(1)}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span>{pick.actual_line}</span>
                    </p>
                  </div>

                  {/* Edge */}
                  <div className="min-w-[60px]">
                    <p className="text-xs text-muted-foreground">Edge</p>
                    <p className={cn(
                      "text-sm font-bold",
                      pick.edge > 0 && pick.recommended_side === 'over' && "text-green-400",
                      pick.edge < 0 && pick.recommended_side === 'under' && "text-green-400",
                      pick.edge > 0 && pick.recommended_side === 'under' && "text-red-400",
                      pick.edge < 0 && pick.recommended_side === 'over' && "text-red-400"
                    )}>
                      {pick.edge > 0 ? '+' : ''}{pick.edge.toFixed(1)}
                    </p>
                  </div>

                  {/* Actual Result */}
                  {pick.actual_value !== null && (
                    <div className="min-w-[50px]">
                      <p className="text-xs text-muted-foreground">Actual</p>
                      <p className={cn(
                        "text-sm font-bold",
                        pick.outcome === 'hit' && "text-green-400",
                        pick.outcome === 'miss' && "text-red-400"
                      )}>
                        {pick.actual_value}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}