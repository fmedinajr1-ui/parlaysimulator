import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, Bot, CheckCircle2, Clock3, Play, RefreshCw, Radar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useSimulationCoverageDiagnostics } from '@/hooks/useSimulationCoverageDiagnostics';

interface ShadowPick {
  id: string;
  sport: string;
  event_id: string;
  home_team: string | null;
  away_team: string | null;
  bet_type: string;
  side: string;
  predicted_score: number;
  line: number;
  odds: number;
  outcome: string;
  created_at: string;
}

export function ShadowPicksFeed() {
  const { toast } = useToast();
  const { data: diagnostics, isLoading: diagnosticsLoading, refetch: refetchDiagnostics } = useSimulationCoverageDiagnostics();
  const [picks, setPicks] = useState<ShadowPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [sportFilter, setSportFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [isConnected, setIsConnected] = useState(false);
  const filtersRef = useRef({ sportFilter, outcomeFilter });

  // Keep ref in sync so realtime callback sees latest filters
  useEffect(() => {
    filtersRef.current = { sportFilter, outcomeFilter };
  }, [sportFilter, outcomeFilter]);

  const fetchPicks = useCallback(async () => {
    let query = supabase
      .from('simulation_shadow_picks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (sportFilter !== 'all') query = query.eq('sport', sportFilter);
    if (outcomeFilter !== 'all') query = query.eq('outcome', outcomeFilter);

    const { data } = await query;
    setPicks((data as ShadowPick[]) || []);
  }, [sportFilter, outcomeFilter]);

  // Initial fetch + refetch on filter change
  useEffect(() => {
    setLoading(true);
    fetchPicks().finally(() => setLoading(false));
  }, [fetchPicks]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('shadow-picks-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'simulation_shadow_picks' },
        (payload) => {
          const newPick = payload.new as ShadowPick;
          const { sportFilter: sf, outcomeFilter: of } = filtersRef.current;
          if (sf !== 'all' && newPick.sport !== sf) return;
          if (of !== 'all' && newPick.outcome !== of) return;
          setPicks((prev) => [newPick, ...prev.slice(0, 49)]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'simulation_shadow_picks' },
        (payload) => {
          const updated = payload.new as ShadowPick;
          setPicks((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p))
          );
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Fallback polling every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPicks();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchPicks]);

  const handleRunSimulation = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('odds-simulation-engine', {
        body: { mode: 'predict' },
      });
      if (error) throw error;
      toast({ title: '🔬 Simulation Complete', description: `Generated ${data?.picksCreated || 0} shadow picks` });
      fetchPicks();
      refetchDiagnostics();
    } catch (e) {
      toast({ title: 'Simulation Failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const sports = [...new Set(picks.map((p) => p.sport))];

  const outcomeBadge = (outcome: string) => {
    switch (outcome) {
      case 'won': return <Badge className="bg-green-600 hover:bg-green-700 text-[10px]">Won</Badge>;
      case 'lost': return <Badge variant="destructive" className="text-[10px]">Lost</Badge>;
      case 'push': return <Badge variant="outline" className="text-[10px]">Push</Badge>;
      default: return <Badge variant="secondary" className="text-[10px]">Pending</Badge>;
    }
  };

  const scoreColor = (score: number) =>
    score >= 80 ? 'text-green-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';

  const reasonTone = (status: 'good' | 'warn' | 'bad') => {
    switch (status) {
      case 'good':
        return 'border-primary/20 bg-primary/5 text-primary';
      case 'warn':
        return 'border-border bg-secondary/50 text-foreground';
      case 'bad':
        return 'border-destructive/20 bg-destructive/10 text-destructive';
      default:
        return 'border-border bg-muted/30 text-muted-foreground';
    }
  };

  const readinessTone = diagnostics?.summary.readiness === 'ready'
    ? 'text-primary'
    : diagnostics?.summary.readiness === 'thin'
      ? 'text-foreground'
      : 'text-destructive';

  const blockCodeLabel = diagnostics?.blockCode?.replace('blocked:', '').replace(/_/g, ' ') || 'unknown';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">Shadow Picks</CardTitle>
            <span className={cn(
              "flex items-center gap-1.5 text-xs",
              isConnected ? "text-emerald-400" : "text-muted-foreground"
            )}>
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                isConnected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
              )} />
              {isConnected ? "Live" : "Connecting..."}
            </span>
          </div>
          <Button size="sm" onClick={handleRunSimulation} disabled={running}>
            {running ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
            Run Simulation
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-2 flex-wrap">
          <Select value={sportFilter} onValueChange={setSportFilter}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Sport" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sports</SelectItem>
              {sports.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tabs value={outcomeFilter} onValueChange={setOutcomeFilter}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-2 h-6">All</TabsTrigger>
              <TabsTrigger value="pending" className="text-xs px-2 h-6">Pending</TabsTrigger>
              <TabsTrigger value="won" className="text-xs px-2 h-6">Won</TabsTrigger>
              <TabsTrigger value="lost" className="text-xs px-2 h-6">Lost</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Radar className="h-4 w-4 text-primary" />
                Freshness & coverage
              </div>
              <p className="text-xs text-muted-foreground">
                Explains why a run produced 0 outputs by checking fresh risk rows, live odds coverage, and minimum match thresholds.
              </p>
              <p className="text-xs text-muted-foreground">
                Current blocker: <span className="font-medium text-foreground">{diagnosticsLoading ? 'loading' : blockCodeLabel}</span>
              </p>
            </div>
            <div className={cn('text-xs font-medium uppercase tracking-wide', readinessTone)}>
              {diagnosticsLoading ? 'Loading' : diagnostics?.summary.readiness || 'Unknown'}
            </div>
          </div>

          {diagnosticsLoading ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : diagnostics ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-md border border-border/60 bg-card/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Fresh risk</div>
                  <div className="mt-1 text-lg font-semibold">{diagnostics.summary.freshRiskRows}/{diagnostics.threshold.minRiskRows}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{diagnostics.summary.staleRiskRows} stale</div>
                </div>
                <div className="rounded-md border border-border/60 bg-card/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Fresh odds</div>
                  <div className="mt-1 text-lg font-semibold">{diagnostics.summary.freshOddsRows}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{diagnostics.summary.oddsRows} total rows</div>
                </div>
                <div className="rounded-md border border-border/60 bg-card/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Matched legs</div>
                  <div className="mt-1 text-lg font-semibold">{diagnostics.summary.freshMatchedRows}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">usable vs min threshold</div>
                </div>
                <div className="rounded-md border border-border/60 bg-card/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Outputs today</div>
                  <div className="mt-1 text-lg font-semibold">{diagnostics.summary.outputsToday}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">shadow picks created</div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-card/60 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> Risk freshness</span>
                    <span>{Math.round(diagnostics.coverage.riskProgressPct)}%</span>
                  </div>
                  <Progress value={diagnostics.coverage.riskProgressPct} className="h-2" />
                </div>
                <div className="rounded-md border border-border/60 bg-card/60 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Match coverage</span>
                    <span>{Math.round(diagnostics.coverage.matchProgressPct)}%</span>
                  </div>
                  <Progress value={diagnostics.coverage.matchProgressPct} className="h-2" />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {diagnostics.reasons.map((reason) => (
                  <div key={reason.label} className={cn('inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs', reasonTone(reason.status))}>
                    {reason.status === 'bad' ? <AlertTriangle className="h-3.5 w-3.5" /> : reason.status === 'warn' ? <Clock3 className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    <span>{reason.label}</span>
                    <span className="font-mono">{reason.count}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-border/60 bg-card/60 p-3">
                <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Upstream stages</span>
                  <span>{diagnostics.upstream.latestOddsUpdateAt ? new Date(diagnostics.upstream.latestOddsUpdateAt).toLocaleTimeString() : 'No odds refresh'}</span>
                </div>
                <div className="space-y-2">
                  {diagnostics.upstream.stages.map((stage) => (
                    <div key={stage.key} className="flex items-start justify-between gap-3 rounded-md border border-border/50 px-3 py-2 text-xs">
                      <div>
                        <div className="font-medium text-foreground">{stage.label}</div>
                        <div className="text-muted-foreground">{stage.detail}</div>
                      </div>
                      <Badge variant="outline" className={cn('uppercase', reasonTone(stage.status))}>
                        {stage.status}
                      </Badge>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-muted-foreground md:grid-cols-3">
                  <div>Odds updated: {diagnostics.upstream.latestOddsUpdateAt ? new Date(diagnostics.upstream.latestOddsUpdateAt).toLocaleString() : '—'}</div>
                  <div>Risk updated: {diagnostics.upstream.latestRiskUpdateAt ? new Date(diagnostics.upstream.latestRiskUpdateAt).toLocaleString() : '—'}</div>
                  <div>Sweet spots updated: {diagnostics.upstream.latestSweetSpotUpdateAt ? new Date(diagnostics.upstream.latestSweetSpotUpdateAt).toLocaleString() : '—'}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : picks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Bot className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No shadow picks yet — hit Run Simulation above</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2 pr-2">
              {picks.map((pick) => (
                <div
                  key={pick.id}
                  className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {pick.sport.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {pick.home_team || '?'} vs {pick.away_team || '?'}
                      </span>
                    </div>
                    {outcomeBadge(pick.outcome)}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {pick.bet_type} <span className="uppercase text-muted-foreground">{pick.side}</span>{' '}
                      {pick.line}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className={cn('font-mono text-xs', scoreColor(pick.predicted_score))}>
                        Score: {pick.predicted_score.toFixed(1)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {pick.odds > 0 ? `+${pick.odds}` : pick.odds}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
