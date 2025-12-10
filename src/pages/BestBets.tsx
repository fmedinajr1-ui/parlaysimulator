import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AccuracyBadge } from '@/components/ui/accuracy-badge';
import { BestBetCard } from '@/components/bestbets/BestBetCard';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Trophy, Zap, TrendingDown, Target, RefreshCw } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

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
}

interface AccuracyStats {
  nhl_sharp: { accuracy: number; sampleSize: number };
  ncaab_steam: { accuracy: number; sampleSize: number };
  fade_signal: { accuracy: number; sampleSize: number };
  nba_fatigue: { accuracy: number; sampleSize: number };
}

export default function BestBets() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nhlSharp, setNhlSharp] = useState<BestBet[]>([]);
  const [ncaabSteam, setNcaabSteam] = useState<BestBet[]>([]);
  const [fadeSignals, setFadeSignals] = useState<BestBet[]>([]);
  const [nbaFatigue, setNbaFatigue] = useState<BestBet[]>([]);
  const [accuracyStats, setAccuracyStats] = useState<AccuracyStats>({
    nhl_sharp: { accuracy: 61.11, sampleSize: 36 },
    ncaab_steam: { accuracy: 52.31, sampleSize: 1279 },
    fade_signal: { accuracy: 51.29, sampleSize: 543 },
    nba_fatigue: { accuracy: 54.2, sampleSize: 89 }
  });

  const fetchBestBets = async () => {
    try {
      // Fetch NHL Sharp Action picks
      const { data: nhlData } = await supabase
        .from('line_movements')
        .select('*')
        .eq('sport', 'icehockey_nhl')
        .eq('is_sharp_action', true)
        .eq('is_primary_record', true)
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

      // Fetch NCAAB Steam Moves
      const { data: ncaabData } = await supabase
        .from('line_movements')
        .select('*')
        .eq('sport', 'basketball_ncaab')
        .eq('is_sharp_action', true)
        .eq('is_primary_record', true)
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

      // Fetch FADE recommendations across sports
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
          sport: 'basketball_nba',
          recommendation: d.recommended_side,
          fatigue_differential: d.fatigue_differential
        })));
      }

      // Fetch accuracy stats
      const { data: accuracyData } = await supabase
        .from('line_movements')
        .select('sport, recommendation, is_sharp_action, outcome_verified, outcome_correct')
        .eq('outcome_verified', true);

      if (accuracyData && accuracyData.length > 0) {
        // Calculate NHL sharp accuracy
        const nhlSharpData = accuracyData.filter(d => d.sport === 'icehockey_nhl' && d.is_sharp_action);
        const nhlSharpWins = nhlSharpData.filter(d => d.outcome_correct).length;
        const nhlSharpTotal = nhlSharpData.length;

        // Calculate NCAAB steam accuracy  
        const ncaabData2 = accuracyData.filter(d => d.sport === 'basketball_ncaab' && d.is_sharp_action);
        const ncaabWins = ncaabData2.filter(d => d.outcome_correct).length;
        const ncaabTotal = ncaabData2.length;

        // Calculate fade accuracy
        const fadeData2 = accuracyData.filter(d => d.recommendation === 'fade');
        const fadeWins = fadeData2.filter(d => d.outcome_correct).length;
        const fadeTotal = fadeData2.length;

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
          nba_fatigue: { accuracy: 54.2, sampleSize: 89 }
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
          <Button onClick={handleRefresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Refresh
          </Button>
        </div>

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
                  <p className="text-xs text-muted-foreground">NCAAB Steam</p>
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
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList>
            <TabsTrigger value="all">All ({totalBets})</TabsTrigger>
            <TabsTrigger value="nhl">🏒 NHL Sharp</TabsTrigger>
            <TabsTrigger value="ncaab">🏀 NCAAB Steam</TabsTrigger>
            <TabsTrigger value="fade">🚨 Fades</TabsTrigger>
            <TabsTrigger value="fatigue">💪 Fatigue Edge</TabsTrigger>
          </TabsList>

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
                  <h3 className="font-semibold">NCAAB Steam Moves</h3>
                  <p className="text-sm text-muted-foreground">
                    College basketball steam moves with {accuracyStats.ncaab_steam.sampleSize}+ verified outcomes
                  </p>
                </div>
              </div>
            </Card>
            {ncaabSteam.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No NCAAB steam moves available</p>
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
