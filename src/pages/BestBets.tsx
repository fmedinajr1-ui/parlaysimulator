import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
// Best Bets - High accuracy signals based on historical performance
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AccuracyBadge } from '@/components/ui/accuracy-badge';
import { BestBetCard } from '@/components/bestbets/BestBetCard';
import { AddToParlayButton } from '@/components/parlay/AddToParlayButton';
import { supabase } from '@/integrations/supabase/client';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
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
  ai_confidence?: number;
  composite_score?: number;
  ai_reasoning?: string;
  signals?: string[];
}

interface AccuracyStats {
  nhl_sharp: { accuracy: number; sampleSize: number };
  ncaab_steam: { accuracy: number; sampleSize: number };
  fade_signal: { accuracy: number; sampleSize: number };
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
}

export default function BestBets() {
  const navigate = useNavigate();
  const { addLeg, legs } = useParlayBuilder();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [nhlSharp, setNhlSharp] = useState<BestBet[]>([]);
  const [ncaabSteam, setNcaabSteam] = useState<BestBet[]>([]);
  const [fadeSignals, setFadeSignals] = useState<BestBet[]>([]);
  const [nbaFatigue, setNbaFatigue] = useState<BestBet[]>([]);
  const [aiBestBets, setAiBestBets] = useState<AIBestBet[]>([]);
  const [accuracyStats, setAccuracyStats] = useState<AccuracyStats>({
    nhl_sharp: { accuracy: 61.11, sampleSize: 36 },
    ncaab_steam: { accuracy: 52.31, sampleSize: 1279 },
    fade_signal: { accuracy: 51.29, sampleSize: 543 },
    nba_fatigue: { accuracy: 54.2, sampleSize: 89 }
  });

  const fetchAIBestBets = async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-best-bets-engine');
      
      if (error) throw error;
      
      if (data?.bestBets) {
        setAiBestBets(data.bestBets);
        
        // Update accuracy stats from real data
        if (data.accuracyData) {
          const acc = data.accuracyData;
          setAccuracyStats(prev => ({
            ...prev,
            nhl_sharp: { 
              accuracy: acc.nhl_pick?.accuracy || prev.nhl_sharp.accuracy, 
              sampleSize: acc.nhl_pick?.total || prev.nhl_sharp.sampleSize 
            },
            ncaab_steam: { 
              accuracy: acc.ncaab_fade?.accuracy || prev.ncaab_steam.accuracy, 
              sampleSize: acc.ncaab_fade?.total || prev.ncaab_steam.sampleSize 
            },
            fade_signal: { 
              accuracy: acc.nba_fade?.accuracy || prev.fade_signal.accuracy, 
              sampleSize: acc.nba_fade?.total || prev.fade_signal.sampleSize 
            },
          }));
        }
        
        toast({
          title: 'AI Analysis Complete',
          description: `Found ${data.bestBets.length} high-confidence picks`
        });
      }
    } catch (error) {
      console.error('AI best bets error:', error);
      toast({
        title: 'AI Analysis Error',
        description: 'Could not fetch AI-powered picks',
        variant: 'destructive'
      });
    } finally {
      setAiLoading(false);
    }
  };

  const fetchBestBets = async () => {
    try {
      // Fetch NHL Sharp Action picks - using correct sport codes
      const { data: nhlData } = await supabase
        .from('line_movements')
        .select('*')
        .ilike('sport', '%nhl%')
        .eq('is_sharp_action', true)
        .eq('is_primary_record', true)
        .eq('recommendation', 'pick') // NHL PICK has 61% accuracy
        .gte('commence_time', new Date().toISOString())
        .order('detected_at', { ascending: false })
        .limit(10);

      if (nhlData) {
        setNhlSharp(nhlData.map(d => ({
          id: d.id,
          event_id: d.event_id,
          description: d.description,
          sport: d.sport,
          commence_time: d.commence_time,
          recommendation: d.recommendation || 'pick',
          odds: d.new_price,
          outcome_name: d.outcome_name,
          sharp_indicator: d.sharp_indicator
        })));
      }

      // Fetch NCAAB Steam Moves - FADE signals (higher accuracy than picks)
      const { data: ncaabData } = await supabase
        .from('line_movements')
        .select('*')
        .ilike('sport', '%ncaab%')
        .eq('is_sharp_action', true)
        .eq('is_primary_record', true)
        .eq('recommendation', 'fade') // NCAAB FADE outperforms PICK
        .gte('commence_time', new Date().toISOString())
        .order('trap_score', { ascending: false })
        .limit(10);

      if (ncaabData) {
        setNcaabSteam(ncaabData.map(d => ({
          id: d.id,
          event_id: d.event_id,
          description: d.description,
          sport: d.sport,
          commence_time: d.commence_time,
          recommendation: 'fade',
          odds: d.new_price,
          outcome_name: d.outcome_name,
          sharp_indicator: d.sharp_indicator,
          trap_score: d.trap_score
        })));
      }

      // Fetch FADE recommendations across sports (high confidence only)
      const { data: fadeData } = await supabase
        .from('line_movements')
        .select('*')
        .eq('recommendation', 'fade')
        .eq('is_primary_record', true)
        .gte('commence_time', new Date().toISOString())
        .gte('authenticity_confidence', 0.6)
        .order('authenticity_confidence', { ascending: false })
        .limit(15);

      if (fadeData) {
        setFadeSignals(fadeData.map(d => ({
          id: d.id,
          event_id: d.event_id,
          description: d.description,
          sport: d.sport,
          commence_time: d.commence_time,
          recommendation: 'fade',
          odds: d.new_price,
          outcome_name: d.outcome_name,
          sharp_indicator: d.sharp_indicator,
          confidence: d.authenticity_confidence
        })));
      }

      // Fetch NBA Fatigue edge games
      const { data: fatigueData } = await supabase
        .from('fatigue_edge_tracking')
        .select('*')
        .gte('fatigue_differential', 20)
        .gte('game_date', new Date().toISOString().split('T')[0])
        .order('fatigue_differential', { ascending: false })
        .limit(10);

      if (fatigueData) {
        setNbaFatigue(fatigueData.map(d => ({
          id: d.id,
          event_id: d.event_id,
          description: `${d.away_team} @ ${d.home_team}`,
          sport: 'NBA',
          recommendation: d.recommended_side,
          fatigue_differential: d.fatigue_differential
        })));
      }

      // Fetch accuracy stats from verified outcomes
      const { data: accuracyData } = await supabase
        .from('line_movements')
        .select('sport, recommendation, is_sharp_action, outcome_verified, outcome_correct')
        .eq('outcome_verified', true);

      if (accuracyData && accuracyData.length > 0) {
        // Calculate NHL sharp PICK accuracy (best performer)
        const nhlSharpPick = accuracyData.filter(d => 
          d.sport?.toLowerCase().includes('nhl') && 
          d.is_sharp_action && 
          d.recommendation === 'pick'
        );
        const nhlSharpWins = nhlSharpPick.filter(d => d.outcome_correct).length;
        const nhlSharpTotal = nhlSharpPick.length;

        // Calculate NCAAB FADE accuracy (outperforms PICK)
        const ncaabFade = accuracyData.filter(d => 
          d.sport?.toLowerCase().includes('ncaab') && 
          d.recommendation === 'fade'
        );
        const ncaabWins = ncaabFade.filter(d => d.outcome_correct).length;
        const ncaabTotal = ncaabFade.length;

        // Calculate overall fade accuracy
        const fadeData2 = accuracyData.filter(d => d.recommendation === 'fade');
        const fadeWins = fadeData2.filter(d => d.outcome_correct).length;
        const fadeTotal = fadeData2.length;

        // Fetch fatigue accuracy separately
        const { data: fatigueStats } = await supabase
          .from('fatigue_edge_tracking')
          .select('recommended_side_won')
          .not('recommended_side_won', 'is', null)
          .gte('fatigue_differential', 20);

        const fatigueWins = fatigueStats?.filter(d => d.recommended_side_won).length || 0;
        const fatigueTotal = fatigueStats?.length || 1;

        setAccuracyStats({
          nhl_sharp: { 
            accuracy: nhlSharpTotal > 0 ? (nhlSharpWins / nhlSharpTotal) * 100 : 61.11, 
            sampleSize: nhlSharpTotal || 36 
          },
          ncaab_steam: { 
            accuracy: ncaabTotal > 0 ? (ncaabWins / ncaabTotal) * 100 : 52.31, 
            sampleSize: ncaabTotal || 1279 
          },
          fade_signal: { 
            accuracy: fadeTotal > 0 ? (fadeWins / fadeTotal) * 100 : 51.29, 
            sampleSize: fadeTotal || 543 
          },
          nba_fatigue: { 
            accuracy: fatigueTotal > 0 ? (fatigueWins / fatigueTotal) * 100 : 54.2, 
            sampleSize: fatigueTotal || 89 
          }
        });
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
    toast({
      title: 'Best Bets Refreshed',
      description: 'Latest high-accuracy signals loaded'
    });
  };

  const handleQuickParlay = () => {
    const betsToAdd: BestBet[] = [];
    
    // Add best NHL Sharp (if available)
    if (nhlSharp.length > 0) {
      betsToAdd.push(nhlSharp[0]);
    }
    
    // Add best NCAAB Fade (if available)
    if (ncaabSteam.length > 0) {
      betsToAdd.push(ncaabSteam[0]);
    }
    
    // Add best Fade signal (if available and different from ncaab)
    if (fadeSignals.length > 0 && !betsToAdd.some(b => b.id === fadeSignals[0].id)) {
      betsToAdd.push(fadeSignals[0]);
    }
    
    // Add best NBA Fatigue (if available)
    if (nbaFatigue.length > 0) {
      betsToAdd.push(nbaFatigue[0]);
    }

    if (betsToAdd.length === 0) {
      toast({
        title: 'No Bets Available',
        description: 'No high-accuracy signals available to build parlay',
        variant: 'destructive'
      });
      return;
    }

    // Add each bet to parlay
    let addedCount = 0;
    betsToAdd.forEach(bet => {
      const source = bet.sport?.toLowerCase().includes('nhl') ? 'sharp' : 
                     bet.fatigue_differential ? 'manual' : 'sharp';
      
      addLeg({
        description: bet.outcome_name || bet.description,
        odds: bet.odds || -110,
        source,
        sport: bet.sport,
        eventId: bet.event_id,
        confidenceScore: bet.confidence,
        sourceData: { 
          recommendation: bet.recommendation,
          sharp_indicator: bet.sharp_indicator,
          fatigue_differential: bet.fatigue_differential
        }
      });
      addedCount++;
    });

    toast({
      title: `Quick Parlay Built`,
      description: `Added ${addedCount} high-accuracy picks to your parlay`
    });

    navigate('/compare');
  };

  useEffect(() => {
    fetchBestBets();
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-chart-1" />
        </div>
      </AppShell>
    );
  }

  const totalBets = nhlSharp.length + ncaabSteam.length + fadeSignals.length + nbaFatigue.length;

  return (
    <AppShell>
      <div className="container max-w-7xl mx-auto px-4 py-6 pb-24 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Trophy className="h-8 w-8 text-chart-4" />
              Best Bets
            </h1>
            <p className="text-muted-foreground mt-1">
              Highest accuracy signals based on historical performance
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={handleQuickParlay} 
              disabled={totalBets === 0}
              className="gap-2 bg-gradient-to-r from-chart-1 to-chart-4"
            >
              <Sparkles className="h-4 w-4" />
              Quick Parlay
            </Button>
            <Button onClick={handleRefresh} disabled={refreshing} variant="outline" className="gap-2">
              <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Parlay Status */}
        {legs.length > 0 && (
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="font-medium">{legs.length} picks in parlay</span>
              </div>
              <Button size="sm" onClick={() => navigate('/compare')}>
                View Parlay
              </Button>
            </div>
          </Card>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">NHL Sharp</p>
                  <p className="text-xl font-bold text-blue-400">{nhlSharp.length}</p>
                </div>
                <AccuracyBadge accuracy={accuracyStats.nhl_sharp.accuracy} size="sm" showIcon={false} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-500/10 to-amber-500/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">NCAAB Fade</p>
                  <p className="text-xl font-bold text-orange-400">{ncaabSteam.length}</p>
                </div>
                <AccuracyBadge accuracy={accuracyStats.ncaab_steam.accuracy} size="sm" showIcon={false} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-500/10 to-pink-500/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Fade Signals</p>
                  <p className="text-xl font-bold text-red-400">{fadeSignals.length}</p>
                </div>
                <AccuracyBadge accuracy={accuracyStats.fade_signal.accuracy} size="sm" showIcon={false} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">NBA Fatigue</p>
                  <p className="text-xl font-bold text-purple-400">{nbaFatigue.length}</p>
                </div>
                <AccuracyBadge accuracy={accuracyStats.nba_fatigue.accuracy} size="sm" showIcon={false} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for categories */}
        <Tabs defaultValue="ai" className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="ai" className="gap-1">
              <Sparkles className="h-3 w-3" />
              AI Picks
            </TabsTrigger>
            <TabsTrigger value="all">All ({totalBets})</TabsTrigger>
            <TabsTrigger value="nhl">🏒 NHL Sharp</TabsTrigger>
            <TabsTrigger value="ncaab">🏀 NCAAB Fade</TabsTrigger>
            <TabsTrigger value="fade">🚨 Fades</TabsTrigger>
            <TabsTrigger value="fatigue">💪 Fatigue Edge</TabsTrigger>
          </TabsList>

          <TabsContent value="ai" className="space-y-4">
            <Card className="p-4 bg-gradient-to-r from-chart-1/10 to-chart-4/10 border-chart-1/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Sparkles className="h-6 w-6 text-chart-1" />
                  <div>
                    <h3 className="font-semibold">AI-Powered Best Bets</h3>
                    <p className="text-sm text-muted-foreground">
                      Machine learning analysis based on verified accuracy data
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={fetchAIBestBets} 
                  disabled={aiLoading}
                  variant="outline"
                  className="gap-2"
                >
                  {aiLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {aiLoading ? 'Analyzing...' : 'Get AI Picks'}
                </Button>
              </div>
            </Card>

            {aiBestBets.length === 0 ? (
              <Card className="p-8 text-center">
                <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No AI Picks Yet</h3>
                <p className="text-muted-foreground mb-4">Click "Get AI Picks" to run the AI analysis engine</p>
                <Button onClick={fetchAIBestBets} disabled={aiLoading}>
                  {aiLoading ? 'Analyzing...' : 'Run AI Analysis'}
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {aiBestBets.map((bet, index) => (
                    <Card 
                      key={bet.id} 
                      className={cn(
                        "bg-gradient-to-br border-border/50 hover:border-border transition-all",
                        index === 0 ? "from-chart-4/20 to-chart-1/10 border-chart-4/30" :
                        index < 3 ? "from-chart-1/15 to-chart-2/5" : "from-muted/10 to-background"
                      )}
                    >
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            {index === 0 && (
                              <Badge className="bg-chart-4/20 text-chart-4 border-chart-4/30">
                                #1 Pick
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-xs">
                              {bet.sport.split('_').pop()?.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">AI Confidence</div>
                            <div className={cn(
                              "font-bold",
                              bet.ai_confidence >= 0.6 ? "text-chart-2" :
                              bet.ai_confidence >= 0.5 ? "text-chart-4" : "text-muted-foreground"
                            )}>
                              {(bet.ai_confidence * 100).toFixed(0)}%
                            </div>
                          </div>
                        </div>

                        <div>
                          <p className="font-semibold">{bet.description}</p>
                          {bet.outcome_name && (
                            <p className="text-sm text-chart-1">{bet.outcome_name}</p>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1">
                          <Badge 
                            variant={bet.recommendation === 'fade' ? 'destructive' : 'default'}
                            className="text-xs uppercase"
                          >
                            {bet.recommendation}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {bet.historical_accuracy.toFixed(1)}% verified
                          </Badge>
                          {bet.odds && (
                            <Badge variant="outline" className="text-xs font-mono">
                              {bet.odds > 0 ? '+' : ''}{bet.odds}
                            </Badge>
                          )}
                        </div>

                        {bet.signals.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {bet.signals.slice(0, 3).map((signal, i) => (
                              <span key={i} className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                                {signal}
                              </span>
                            ))}
                          </div>
                        )}

                        {bet.ai_reasoning && (
                          <p className="text-xs text-muted-foreground italic border-t border-border/50 pt-2">
                            "{bet.ai_reasoning}"
                          </p>
                        )}

                        <div className="flex justify-end pt-2">
                          <AddToParlayButton
                            description={bet.outcome_name || bet.description}
                            odds={bet.odds || -110}
                            source="sharp"
                            sport={bet.sport}
                            eventId={bet.event_id}
                            confidenceScore={bet.ai_confidence}
                            sourceData={{
                              type: 'ai_pick',
                              recommendation: bet.recommendation,
                              ai_confidence: bet.ai_confidence,
                              historical_accuracy: bet.historical_accuracy,
                              composite_score: bet.composite_score,
                              signals: bet.signals
                            }}
                            variant="compact"
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="all" className="space-y-4">
            {totalBets === 0 ? (
              <Card className="p-8 text-center">
                <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No Best Bets Available</h3>
                <p className="text-muted-foreground">Check back later for high-accuracy signals</p>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {nhlSharp.map(bet => (
                  <BestBetCard
                    key={bet.id}
                    type="nhl_sharp"
                    event={bet}
                    accuracy={accuracyStats.nhl_sharp.accuracy}
                    sampleSize={accuracyStats.nhl_sharp.sampleSize}
                  />
                ))}
                {ncaabSteam.map(bet => (
                  <BestBetCard
                    key={bet.id}
                    type="ncaab_steam"
                    event={bet}
                    accuracy={accuracyStats.ncaab_steam.accuracy}
                    sampleSize={accuracyStats.ncaab_steam.sampleSize}
                  />
                ))}
                {fadeSignals.slice(0, 6).map(bet => (
                  <BestBetCard
                    key={bet.id}
                    type="fade_signal"
                    event={bet}
                    accuracy={accuracyStats.fade_signal.accuracy}
                    sampleSize={accuracyStats.fade_signal.sampleSize}
                  />
                ))}
                {nbaFatigue.map(bet => (
                  <BestBetCard
                    key={bet.id}
                    type="nba_fatigue"
                    event={bet}
                    accuracy={accuracyStats.nba_fatigue.accuracy}
                    sampleSize={accuracyStats.nba_fatigue.sampleSize}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="nhl" className="space-y-4">
            <Card className="p-4 bg-blue-500/5 border-blue-500/20">
              <div className="flex items-center gap-3">
                <Zap className="h-6 w-6 text-blue-400" />
                <div>
                  <h3 className="font-semibold">NHL Sharp Action Picks</h3>
                  <p className="text-sm text-muted-foreground">
                    Sharp money signals in NHL have {accuracyStats.nhl_sharp.accuracy.toFixed(1)}% historical win rate
                  </p>
                </div>
              </div>
            </Card>
            {nhlSharp.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No NHL sharp signals available</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {nhlSharp.map(bet => (
                  <BestBetCard
                    key={bet.id}
                    type="nhl_sharp"
                    event={bet}
                    accuracy={accuracyStats.nhl_sharp.accuracy}
                    sampleSize={accuracyStats.nhl_sharp.sampleSize}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="ncaab" className="space-y-4">
            <Card className="p-4 bg-orange-500/5 border-orange-500/20">
              <div className="flex items-center gap-3">
                <TrendingDown className="h-6 w-6 text-orange-400" />
                <div>
                  <h3 className="font-semibold">NCAAB Fade Signals</h3>
                  <p className="text-sm text-muted-foreground">
                    College basketball FADE outperforms PICK with {accuracyStats.ncaab_steam.accuracy.toFixed(1)}% win rate
                  </p>
                </div>
              </div>
            </Card>
            {ncaabSteam.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No NCAAB fade signals available</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {ncaabSteam.map(bet => (
                  <BestBetCard
                    key={bet.id}
                    type="ncaab_steam"
                    event={bet}
                    accuracy={accuracyStats.ncaab_steam.accuracy}
                    sampleSize={accuracyStats.ncaab_steam.sampleSize}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="fade" className="space-y-4">
            <Card className="p-4 bg-red-500/5 border-red-500/20">
              <div className="flex items-center gap-3">
                <TrendingDown className="h-6 w-6 text-red-400" />
                <div>
                  <h3 className="font-semibold">FADE Recommendations</h3>
                  <p className="text-sm text-muted-foreground">
                    Fade signals outperform picks at {accuracyStats.fade_signal.accuracy.toFixed(1)}% across all sports
                  </p>
                </div>
              </div>
            </Card>
            {fadeSignals.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No fade signals available</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {fadeSignals.map(bet => (
                  <BestBetCard
                    key={bet.id}
                    type="fade_signal"
                    event={bet}
                    accuracy={accuracyStats.fade_signal.accuracy}
                    sampleSize={accuracyStats.fade_signal.sampleSize}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="fatigue" className="space-y-4">
            <Card className="p-4 bg-purple-500/5 border-purple-500/20">
              <div className="flex items-center gap-3">
                <Zap className="h-6 w-6 text-purple-400" />
                <div>
                  <h3 className="font-semibold">NBA Fatigue Edge</h3>
                  <p className="text-sm text-muted-foreground">
                    Games with 20+ fatigue differential showing {accuracyStats.nba_fatigue.accuracy.toFixed(1)}% edge
                  </p>
                </div>
              </div>
            </Card>
            {nbaFatigue.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No high fatigue differential games today</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {nbaFatigue.map(bet => (
                  <BestBetCard
                    key={bet.id}
                    type="nba_fatigue"
                    event={bet}
                    accuracy={accuracyStats.nba_fatigue.accuracy}
                    sampleSize={accuracyStats.nba_fatigue.sampleSize}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
