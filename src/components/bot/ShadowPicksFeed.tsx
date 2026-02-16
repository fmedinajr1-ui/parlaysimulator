import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bot, Play, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

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
