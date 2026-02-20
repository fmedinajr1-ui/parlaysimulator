import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AccuracyBadge } from '@/components/ui/accuracy-badge';
import { BestBetCard } from '@/components/bestbets/BestBetCard';
import { AddToParlayButton } from '@/components/parlay/AddToParlayButton';
import { supabase } from '@/integrations/supabase/client';
import { getEasternDate } from '@/lib/dateUtils';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { useBankroll } from '@/hooks/useBankroll';
import { Loader2, Trophy, Zap, TrendingDown, Target, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface BestBet {
  id: string;
  event_id: string;
  description: string;
  sport: string;
  commence_time?: string;
  recommendation: string;
  confidence?: number;
  odds?: number;
  player_name?: string;
  outcome_name?: string;
  sharp_indicator?: string;
  trap_score?: number;
  fatigue_differential?: number;
  coaching_tendency?: string;
  coach_name?: string;
}

interface AccuracyStats {
  nfl_fade: { accuracy: number; sampleSize: number };
  nhl_caution: { accuracy: number; sampleSize: number };
  ncaab_fade: { accuracy: number; sampleSize: number };
  nba_fatigue: { accuracy: number; sampleSize: number };
}

interface AIBestBet {
  id: string;
  event_id: string;
  description: string;
  sport: string;
  recommendation: string;
  commence_time?: string;
  outcome_name?: string;
  odds?: number;
  historical_accuracy: number;
  ai_confidence: number;
  composite_score: number;
  ai_reasoning?: string;
  signals: string[];
  signal_type?: string;
  sample_size?: number;
  coaching_tendency?: string;
  coach_name?: string;
}

export default function BestBets() {
  const navigate = useNavigate();
  const { addLeg, legs } = useParlayBuilder();
  const { settings: bankrollSettings } = useBankroll();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [nflFade, setNflFade] = useState<BestBet[]>([]);
  const [ncaabFade, setNcaabFade] = useState<BestBet[]>([]);
  const [nhlCaution, setNhlCaution] = useState<BestBet[]>([]);
  const [nbaFatigue, setNbaFatigue] = useState<BestBet[]>([]);
  const [aiBestBets, setAiBestBets] = useState<AIBestBet[]>([]);
  const [accuracyStats, setAccuracyStats] = useState<AccuracyStats>({
    nfl_fade: { accuracy: 66.54, sampleSize: 260 },
    nhl_caution: { accuracy: 53.08, sampleSize: 552 },
    ncaab_fade: { accuracy: 52.92, sampleSize: 907 },
    nba_fatigue: { accuracy: 54.2, sampleSize: 89 }
  });

  const fetchAIBestBets = async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-best-bets-engine');
      if (error) throw error;
      if (data?.bestBets) {
        setAiBestBets(data.bestBets);
        toast({ title: 'AI Analysis Complete', description: `Found ${data.bestBets.length} high-confidence picks` });
      }
    } catch (error) {
      console.error('AI best bets error:', error);
      toast({ title: 'AI Analysis Error', description: 'Could not fetch AI-powered picks', variant: 'destructive' });
    } finally {
      setAiLoading(false);
    }
  };

  const fetchBestBets = async () => {
    try {
      // NFL FADE - TOP PERFORMER (66.54%)
      const { data: nflFadeData } = await supabase
        .from('line_movements')
        .select('*')
        .ilike('sport', '%nfl%')
        .eq('is_primary_record', true)
        .eq('recommendation', 'fade')
        .gte('commence_time', new Date().toISOString())
        .order('trap_score', { ascending: false })
        .limit(15);

      if (nflFadeData) {
        setNflFade(nflFadeData.map(d => ({
          id: d.id, event_id: d.event_id, description: d.description, sport: d.sport,
          commence_time: d.commence_time, recommendation: 'fade', odds: d.new_price,
          outcome_name: d.outcome_name, sharp_indicator: d.sharp_indicator, trap_score: d.trap_score
        })));
      }

      // NHL CAUTION - Profitable (53.08%)
      const { data: nhlData } = await supabase
        .from('line_movements')
        .select('*')
        .ilike('sport', '%nhl%')
        .eq('is_primary_record', true)
        .eq('recommendation', 'caution')
        .gte('commence_time', new Date().toISOString())
        .order('authenticity_confidence', { ascending: false })
        .limit(10);

      if (nhlData) {
        setNhlCaution(nhlData.map(d => ({
          id: d.id, event_id: d.event_id, description: d.description, sport: d.sport,
          commence_time: d.commence_time, recommendation: 'caution', odds: d.new_price,
          outcome_name: d.outcome_name, sharp_indicator: d.sharp_indicator
        })));
      }

      // NCAAB FADE - Profitable (52.92%)
      const { data: ncaabData } = await supabase
        .from('line_movements')
        .select('*')
        .ilike('sport', '%ncaab%')
        .eq('is_primary_record', true)
        .eq('recommendation', 'fade')
        .gte('commence_time', new Date().toISOString())
        .order('trap_score', { ascending: false })
        .limit(15);

      if (ncaabData) {
        setNcaabFade(ncaabData.map(d => ({
          id: d.id, event_id: d.event_id, description: d.description, sport: d.sport,
          commence_time: d.commence_time, recommendation: 'fade', odds: d.new_price,
          outcome_name: d.outcome_name, trap_score: d.trap_score
        })));
      }

      // NBA Fatigue edge games
      const { data: fatigueData } = await supabase
        .from('fatigue_edge_tracking')
        .select('*')
        .gte('fatigue_differential', 20)
        .gte('game_date', getEasternDate())
        .order('fatigue_differential', { ascending: false })
        .limit(10);

      if (fatigueData) {
        setNbaFatigue(fatigueData.map(d => ({
          id: d.id, event_id: d.event_id, description: `${d.away_team} @ ${d.home_team}`,
          sport: 'NBA', recommendation: d.recommended_side, fatigue_differential: d.fatigue_differential
        })));
      }
    } catch (error) {
      console.error('Error fetching best bets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchBestBets();
    setRefreshing(false);
    toast({ title: 'Best Bets Refreshed', description: 'Latest high-accuracy signals loaded' });
  };

  const handleQuickParlay = () => {
    const betsToAdd: BestBet[] = [];
    if (nflFade.length > 0) betsToAdd.push(nflFade[0]);
    if (ncaabFade.length > 0) betsToAdd.push(ncaabFade[0]);
    if (nbaFatigue.length > 0) betsToAdd.push(nbaFatigue[0]);

    if (betsToAdd.length === 0) {
      toast({ title: 'No Bets Available', description: 'No high-accuracy signals available', variant: 'destructive' });
      return;
    }

    betsToAdd.forEach(bet => {
      addLeg({
        description: bet.outcome_name || bet.description,
        odds: bet.odds || -110,
        source: 'sharp',
        sport: bet.sport,
        eventId: bet.event_id,
        confidenceScore: bet.confidence,
        sourceData: { recommendation: bet.recommendation }
      });
    });

    toast({ title: `Quick Parlay Built`, description: `Added ${betsToAdd.length} high-accuracy picks` });
    navigate('/compare');
  };

  useEffect(() => { fetchBestBets(); }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-chart-1" />
        </div>
      </AppShell>
    );
  }

  const totalBets = nflFade.length + ncaabFade.length + nhlCaution.length + nbaFatigue.length;

  return (
    <AppShell>
      <div className="container max-w-7xl mx-auto px-4 py-6 pb-6 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Trophy className="h-8 w-8 text-chart-4" />
              Best Bets
            </h1>
            <p className="text-muted-foreground mt-1">Highest accuracy signals based on verified historical data</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleQuickParlay} disabled={totalBets === 0} className="gap-2 bg-gradient-to-r from-chart-1 to-chart-4">
              <Sparkles className="h-4 w-4" />Quick Parlay
            </Button>
            <Button onClick={handleRefresh} disabled={refreshing} variant="outline" className="gap-2">
              <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />Refresh
            </Button>
          </div>
        </div>

        {legs.length > 0 && (
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="font-medium">{legs.length} picks in parlay</span>
              </div>
              <Button size="sm" onClick={() => navigate('/compare')}>View Parlay</Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 ring-2 ring-green-500/30">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">🏈 NFL Fade</p>
                  <p className="text-xl font-bold text-green-400">{nflFade.length}</p>
                  <Badge className="text-xs bg-green-500/20 text-green-400 mt-1">TOP</Badge>
                </div>
                <AccuracyBadge accuracy={accuracyStats.nfl_fade.accuracy} sampleSize={accuracyStats.nfl_fade.sampleSize} size="sm" showIcon={false} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-cyan-500/10 to-blue-500/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">🏒 NHL Caution</p>
                  <p className="text-xl font-bold text-cyan-400">{nhlCaution.length}</p>
                </div>
                <AccuracyBadge accuracy={accuracyStats.nhl_caution.accuracy} sampleSize={accuracyStats.nhl_caution.sampleSize} size="sm" showIcon={false} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-500/10 to-amber-500/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">🏀 NCAAB Fade</p>
                  <p className="text-xl font-bold text-orange-400">{ncaabFade.length}</p>
                </div>
                <AccuracyBadge accuracy={accuracyStats.ncaab_fade.accuracy} sampleSize={accuracyStats.ncaab_fade.sampleSize} size="sm" showIcon={false} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">💪 NBA Fatigue</p>
                  <p className="text-xl font-bold text-purple-400">{nbaFatigue.length}</p>
                </div>
                <AccuracyBadge accuracy={accuracyStats.nba_fatigue.accuracy} sampleSize={accuracyStats.nba_fatigue.sampleSize} size="sm" showIcon={false} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="ai" className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="ai" className="gap-1"><Sparkles className="h-3 w-3" />AI Picks</TabsTrigger>
            <TabsTrigger value="all">All ({totalBets})</TabsTrigger>
            <TabsTrigger value="nfl">🏈 NFL Fade</TabsTrigger>
            <TabsTrigger value="ncaab">🏀 NCAAB Fade</TabsTrigger>
            <TabsTrigger value="nhl">🏒 NHL Caution</TabsTrigger>
            <TabsTrigger value="fatigue">💪 Fatigue</TabsTrigger>
          </TabsList>

          <TabsContent value="ai" className="space-y-4">
            <Card className="p-4 bg-gradient-to-r from-chart-1/10 to-chart-4/10 border-chart-1/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Sparkles className="h-6 w-6 text-chart-1" />
                  <div>
                    <h3 className="font-semibold">AI-Powered Best Bets</h3>
                    <p className="text-sm text-muted-foreground">Based on verified accuracy data - NFL FADE is our top performer at 66.54%</p>
                  </div>
                </div>
                <Button onClick={fetchAIBestBets} disabled={aiLoading} variant="outline" className="gap-2">
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {aiLoading ? 'Analyzing...' : 'Get AI Picks'}
                </Button>
              </div>
            </Card>

            {aiBestBets.length === 0 ? (
              <Card className="p-8 text-center">
                <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No AI Picks Yet</h3>
                <p className="text-muted-foreground mb-4">Click "Get AI Picks" to run the AI analysis engine</p>
                <Button onClick={fetchAIBestBets} disabled={aiLoading}>{aiLoading ? 'Analyzing...' : 'Run AI Analysis'}</Button>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {aiBestBets.map((bet, index) => (
                  <Card key={bet.id} className={cn("bg-gradient-to-br border-border/50", index === 0 ? "from-chart-4/20 to-chart-1/10 ring-2 ring-green-500/30" : "from-muted/10 to-background")}>
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {bet.signal_type === 'nfl_fade' && <Badge className="bg-green-500/20 text-green-400">TOP</Badge>}
                          {bet.signal_type?.startsWith('coaching') && <Badge className="bg-emerald-500/20 text-emerald-400">COACH</Badge>}
                          <Badge variant="outline" className="text-xs">{bet.sport.split('_').pop()?.toUpperCase()}</Badge>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">AI Confidence</div>
                          <div className={cn("font-bold", bet.ai_confidence >= 0.6 ? "text-chart-2" : "text-muted-foreground")}>{(bet.ai_confidence * 100).toFixed(0)}%</div>
                        </div>
                      </div>
                      <div>
                        <p className="font-semibold">{bet.description}</p>
                        {bet.outcome_name && <p className="text-sm text-chart-1">{bet.outcome_name}</p>}
                        {bet.coach_name && <p className="text-xs text-emerald-400">🏀 Coach {bet.coach_name}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={bet.recommendation === 'fade' ? 'destructive' : 'default'} className="text-xs uppercase">{bet.recommendation}</Badge>
                        <Badge variant="secondary" className="text-xs">{bet.historical_accuracy.toFixed(1)}% (n={bet.sample_size || 0})</Badge>
                      </div>
                      {bet.ai_reasoning && <p className="text-xs text-muted-foreground italic border-t border-border/50 pt-2">"{bet.ai_reasoning}"</p>}
                      <div className="flex justify-end pt-2">
                        <AddToParlayButton description={bet.outcome_name || bet.description} odds={bet.odds || -110} source="sharp" sport={bet.sport} eventId={bet.event_id} confidenceScore={bet.ai_confidence} variant="compact" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="all" className="space-y-4">
            {totalBets === 0 ? (
              <Card className="p-8 text-center"><Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><h3 className="text-lg font-semibold">No Best Bets Available</h3></Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {nflFade.map(bet => <BestBetCard key={bet.id} type="nfl_fade" event={bet} accuracy={accuracyStats.nfl_fade.accuracy} sampleSize={accuracyStats.nfl_fade.sampleSize} bankrollSettings={bankrollSettings} />)}
                {ncaabFade.map(bet => <BestBetCard key={bet.id} type="ncaab_steam" event={bet} accuracy={accuracyStats.ncaab_fade.accuracy} sampleSize={accuracyStats.ncaab_fade.sampleSize} bankrollSettings={bankrollSettings} />)}
                {nhlCaution.map(bet => <BestBetCard key={bet.id} type="nhl_caution" event={bet} accuracy={accuracyStats.nhl_caution.accuracy} sampleSize={accuracyStats.nhl_caution.sampleSize} bankrollSettings={bankrollSettings} />)}
                {nbaFatigue.map(bet => <BestBetCard key={bet.id} type="nba_fatigue" event={bet} accuracy={accuracyStats.nba_fatigue.accuracy} sampleSize={accuracyStats.nba_fatigue.sampleSize} bankrollSettings={bankrollSettings} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="nfl" className="space-y-4">
            <Card className="p-4 bg-green-500/5 border-green-500/20">
              <div className="flex items-center gap-3">
                <Trophy className="h-6 w-6 text-green-400" />
                <div>
                  <h3 className="font-semibold">🏈 NFL Fade Signals - TOP PERFORMER</h3>
                  <p className="text-sm text-muted-foreground">NFL fade signals have {accuracyStats.nfl_fade.accuracy.toFixed(1)}% historical win rate (n={accuracyStats.nfl_fade.sampleSize})</p>
                </div>
              </div>
            </Card>
            {nflFade.length === 0 ? <p className="text-center text-muted-foreground py-8">No NFL fade signals available</p> : (
              <div className="grid gap-4 md:grid-cols-2">{nflFade.map(bet => <BestBetCard key={bet.id} type="nfl_fade" event={bet} accuracy={accuracyStats.nfl_fade.accuracy} sampleSize={accuracyStats.nfl_fade.sampleSize} bankrollSettings={bankrollSettings} />)}</div>
            )}
          </TabsContent>

          <TabsContent value="ncaab" className="space-y-4">
            <Card className="p-4 bg-orange-500/5 border-orange-500/20">
              <div className="flex items-center gap-3"><TrendingDown className="h-6 w-6 text-orange-400" /><div><h3 className="font-semibold">🏀 NCAAB Fade Signals</h3><p className="text-sm text-muted-foreground">NCAAB fade at {accuracyStats.ncaab_fade.accuracy.toFixed(1)}% (n={accuracyStats.ncaab_fade.sampleSize})</p></div></div>
            </Card>
            {ncaabFade.length === 0 ? <p className="text-center text-muted-foreground py-8">No NCAAB fade signals</p> : (
              <div className="grid gap-4 md:grid-cols-2">{ncaabFade.map(bet => <BestBetCard key={bet.id} type="ncaab_steam" event={bet} accuracy={accuracyStats.ncaab_fade.accuracy} sampleSize={accuracyStats.ncaab_fade.sampleSize} bankrollSettings={bankrollSettings} />)}</div>
            )}
          </TabsContent>

          <TabsContent value="nhl" className="space-y-4">
            <Card className="p-4 bg-cyan-500/5 border-cyan-500/20">
              <div className="flex items-center gap-3"><Zap className="h-6 w-6 text-cyan-400" /><div><h3 className="font-semibold">🏒 NHL Caution Signals</h3><p className="text-sm text-muted-foreground">NHL caution at {accuracyStats.nhl_caution.accuracy.toFixed(1)}% (n={accuracyStats.nhl_caution.sampleSize})</p></div></div>
            </Card>
            {nhlCaution.length === 0 ? <p className="text-center text-muted-foreground py-8">No NHL caution signals</p> : (
              <div className="grid gap-4 md:grid-cols-2">{nhlCaution.map(bet => <BestBetCard key={bet.id} type="nhl_caution" event={bet} accuracy={accuracyStats.nhl_caution.accuracy} sampleSize={accuracyStats.nhl_caution.sampleSize} bankrollSettings={bankrollSettings} />)}</div>
            )}
          </TabsContent>

          <TabsContent value="fatigue" className="space-y-4">
            <Card className="p-4 bg-purple-500/5 border-purple-500/20">
              <div className="flex items-center gap-3"><Zap className="h-6 w-6 text-purple-400" /><div><h3 className="font-semibold">💪 NBA Fatigue Edge</h3><p className="text-sm text-muted-foreground">Games with 20+ fatigue diff at {accuracyStats.nba_fatigue.accuracy.toFixed(1)}%</p></div></div>
            </Card>
            {nbaFatigue.length === 0 ? <p className="text-center text-muted-foreground py-8">No high fatigue games</p> : (
              <div className="grid gap-4 md:grid-cols-2">{nbaFatigue.map(bet => <BestBetCard key={bet.id} type="nba_fatigue" event={bet} accuracy={accuracyStats.nba_fatigue.accuracy} sampleSize={accuracyStats.nba_fatigue.sampleSize} bankrollSettings={bankrollSettings} />)}</div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
