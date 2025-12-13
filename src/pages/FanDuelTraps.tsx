import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Target, 
  TrendingUp, 
  AlertTriangle, 
  Zap, 
  Clock,
  RefreshCw,
  Trophy,
  ChevronRight,
  Loader2,
  BarChart3,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';

interface TrapAnalysis {
  id: string;
  scan_round: number;
  event_id: string;
  sport: string;
  description: string;
  player_name?: string;
  market_type: string;
  outcome_name: string;
  opening_price: number;
  current_price: number;
  total_movement: number;
  movement_direction: string;
  trap_score: number;
  is_public_bait: boolean;
  public_bait_reason: string;
  fade_the_public_pick: string;
  odds_for_fade: number;
  confidence_score: number;
  commence_time: string;
  scanned_at: string;
}

interface DailyParlay {
  id: string;
  parlay_date: string;
  legs: any[];
  total_odds: number;
  target_odds: number;
  confidence_score: number;
  reasoning_summary: string;
  movement_analysis: any;
  scans_completed: number;
  total_movements_analyzed: number;
  trap_patterns_found: number;
  outcome: string;
}

export default function FanDuelTraps() {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split('T')[0];
  
  // Fetch trap analysis for today
  const { data: trapAnalysis, isLoading: loadingTraps } = useQuery({
    queryKey: ['fanduel-traps', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fanduel_trap_analysis')
        .select('*')
        .eq('scan_date', today)
        .order('trap_score', { ascending: false });
      
      if (error) throw error;
      return data as TrapAnalysis[];
    },
    refetchInterval: 60000 // Refresh every minute
  });
  
  // Fetch daily parlay
  const { data: dailyParlay, isLoading: loadingParlay } = useQuery({
    queryKey: ['fanduel-daily-parlay', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fanduel_daily_parlay')
        .select('*')
        .eq('parlay_date', today)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data as DailyParlay | null;
    },
    refetchInterval: 60000
  });
  
  // Run scanner mutation
  const runScanner = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('fanduel-trap-scanner');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Scan complete! Found ${data.trapPatternsFound} trap patterns`);
      queryClient.invalidateQueries({ queryKey: ['fanduel-traps'] });
      queryClient.invalidateQueries({ queryKey: ['fanduel-daily-parlay'] });
    },
    onError: (error) => {
      toast.error(`Scan failed: ${error.message}`);
    }
  });
  
  // Build parlay mutation
  const buildParlay = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('fanduel-daily-parlay-builder');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Built ${data.parlay.legs}-leg parlay @ +${data.parlay.totalOdds}!`);
      } else {
        toast.warning(data.message);
      }
      queryClient.invalidateQueries({ queryKey: ['fanduel-daily-parlay'] });
    },
    onError: (error) => {
      toast.error(`Build failed: ${error.message}`);
    }
  });
  
  const highConfidenceTraps = trapAnalysis?.filter(t => t.trap_score >= 40) || [];
  const progressPercent = dailyParlay ? Math.min((dailyParlay.scans_completed / 24) * 100, 100) : 0;
  
  const getSportEmoji = (sport: string) => {
    if (sport.includes('basketball')) return '🏀';
    if (sport.includes('football')) return '🏈';
    if (sport.includes('hockey')) return '🏒';
    if (sport.includes('baseball')) return '⚾';
    return '🎯';
  };
  
  const getTrapScoreColor = (score: number) => {
    if (score >= 70) return 'text-red-500';
    if (score >= 50) return 'text-orange-500';
    if (score >= 40) return 'text-yellow-500';
    return 'text-muted-foreground';
  };

  return (
    <div className="container mx-auto p-4 space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            FanDuel Trap Detector
          </h1>
          <p className="text-muted-foreground text-sm">
            Hourly analysis of FanDuel line movements to detect public traps
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => runScanner.mutate()}
            disabled={runScanner.isPending}
          >
            {runScanner.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Run Scan
          </Button>
          <Button 
            size="sm"
            onClick={() => buildParlay.mutate()}
            disabled={buildParlay.isPending || highConfidenceTraps.length < 3}
          >
            {buildParlay.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Trophy className="h-4 w-4 mr-2" />
            )}
            Build Parlay
          </Button>
        </div>
      </div>
      
      {/* Progress Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Today's Analysis Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>Hourly Scans</span>
                <span className="font-medium">{dailyParlay?.scans_completed || 0}/24</span>
              </div>
              <Progress value={progressPercent} className="h-3" />
            </div>
            
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-secondary/50 rounded-lg p-3">
                <div className="text-2xl font-bold">{dailyParlay?.total_movements_analyzed || 0}</div>
                <div className="text-xs text-muted-foreground">Lines Tracked</div>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3">
                <div className="text-2xl font-bold text-orange-500">{dailyParlay?.trap_patterns_found || 0}</div>
                <div className="text-xs text-muted-foreground">Traps Found</div>
              </div>
              <div className="bg-secondary/50 rounded-lg p-3">
                <div className="text-2xl font-bold text-green-500">{highConfidenceTraps.length}</div>
                <div className="text-xs text-muted-foreground">High Confidence</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Daily Parlay Card */}
      {dailyParlay?.legs && dailyParlay.legs.length > 0 && (
        <Card className="border-2 border-primary/50 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <Badge variant="default" className="mb-2">🎯 Today's Fade Parlay</Badge>
                <CardTitle className="text-xl">
                  Target: +{dailyParlay.target_odds} | Actual: +{Math.round(dailyParlay.total_odds)}
                </CardTitle>
                <CardDescription>
                  {dailyParlay.legs.length} legs • {Math.round((dailyParlay.confidence_score || 0) * 100)}% confidence
                </CardDescription>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-primary">
                  +{Math.round(dailyParlay.total_odds)}
                </div>
                <div className="text-xs text-muted-foreground">Combined Odds</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Parlay Legs */}
            <div className="space-y-3">
              {dailyParlay.legs.map((leg: any, index: number) => (
                <div 
                  key={leg.id || index}
                  className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{getSportEmoji(leg.sport)}</span>
                    <div>
                      <div className="font-medium text-sm">{leg.description}</div>
                      <div className="text-xs text-muted-foreground">{leg.fadePick}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className={getTrapScoreColor(leg.trapScore)}>
                      {leg.trapScore}
                    </Badge>
                    <div className="text-sm font-medium mt-1">
                      {leg.odds > 0 ? '+' : ''}{leg.odds}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Reasoning Summary */}
            {dailyParlay.reasoning_summary && (
              <div className="mt-4 p-4 bg-secondary/20 rounded-lg">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Analysis Summary
                </h4>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {dailyParlay.reasoning_summary}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Trap Analysis Tabs */}
      <Tabs defaultValue="high" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="high">
            High Traps ({highConfidenceTraps.length})
          </TabsTrigger>
          <TabsTrigger value="all">
            All ({trapAnalysis?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="live">
            Live Feed
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="high">
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {loadingTraps ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : highConfidenceTraps.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No high-confidence traps detected yet</p>
                    <p className="text-sm">Run a scan to detect FanDuel line traps</p>
                  </CardContent>
                </Card>
              ) : (
                highConfidenceTraps.map((trap) => (
                  <TrapCard key={trap.id} trap={trap} />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
        
        <TabsContent value="all">
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {trapAnalysis?.map((trap) => (
                <TrapCard key={trap.id} trap={trap} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
        
        <TabsContent value="live">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Live feed updates every hour</p>
              <p className="text-sm">Next scan in {60 - new Date().getMinutes()} minutes</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TrapCard({ trap }: { trap: TrapAnalysis }) {
  const getSportEmoji = (sport: string) => {
    if (sport.includes('basketball')) return '🏀';
    if (sport.includes('football')) return '🏈';
    if (sport.includes('hockey')) return '🏒';
    return '🎯';
  };
  
  const getTrapScoreColor = (score: number) => {
    if (score >= 70) return 'bg-red-500/20 text-red-500 border-red-500/30';
    if (score >= 50) return 'bg-orange-500/20 text-orange-500 border-orange-500/30';
    if (score >= 40) return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30';
    return 'bg-secondary text-muted-foreground';
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <span className="text-xl">{getSportEmoji(trap.sport)}</span>
            <div>
              <div className="font-medium">{trap.description}</div>
              <div className="text-sm text-muted-foreground">
                {trap.market_type.toUpperCase()} • {trap.outcome_name}
              </div>
              {trap.is_public_bait && trap.fade_the_public_pick && (
                <div className="mt-2 text-sm font-medium text-primary">
                  {trap.fade_the_public_pick}
                </div>
              )}
              {trap.public_bait_reason && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {trap.public_bait_reason}
                </div>
              )}
            </div>
          </div>
          <div className="text-right space-y-2">
            <Badge className={getTrapScoreColor(trap.trap_score)}>
              {trap.trap_score}
            </Badge>
            <div className="text-sm">
              <span className={trap.movement_direction === 'shortened' ? 'text-red-500' : 'text-green-500'}>
                {trap.movement_direction === 'shortened' ? '↓' : '↑'} {Math.abs(trap.total_movement)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {trap.opening_price} → {trap.current_price}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
