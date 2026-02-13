import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  RefreshCw, 
  TrendingUp, 
  TrendingDown,
  Target,
  Zap,
  Activity,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { TeamBetCard } from './TeamBetCard';

const SPORTS = ['ALL', 'NCAAB', 'NBA', 'NHL', 'NFL', 'NCAAF', 'WNBA'];
const BET_TYPES = [
  { id: 'all', label: 'All Bets', icon: Activity },
  { id: 'spread', label: 'Spreads', icon: TrendingUp },
  { id: 'total', label: 'Totals', icon: Target },
  { id: 'h2h', label: 'Moneyline', icon: Zap },
];

interface GameBet {
  id: string;
  game_id: string;
  sport: string;
  bet_type: string;
  home_team: string;
  away_team: string;
  line: number | null;
  home_odds: number | null;
  away_odds: number | null;
  over_odds: number | null;
  under_odds: number | null;
  bookmaker: string;
  commence_time: string;
  sharp_score: number | null;
  composite_score: number | null;
  score_breakdown: Record<string, number | string> | null;
  recommended_side: string | null;
  signal_sources: string[] | null;
  is_active: boolean;
  outcome: string | null;
}

// Map sport keys to display names
function getSportDisplay(sport: string): string {
  const map: Record<string, string> = {
    'basketball_nba': 'NBA',
    'icehockey_nhl': 'NHL',
    'americanfootball_nfl': 'NFL',
    'basketball_ncaab': 'NCAAB',
    'americanfootball_ncaaf': 'NCAAF',
    'basketball_wnba': 'WNBA',
  };
  return map[sport] || sport.toUpperCase();
}

function getSportKey(display: string): string {
  const map: Record<string, string> = {
    'NBA': 'basketball_nba',
    'NHL': 'icehockey_nhl',
    'NFL': 'americanfootball_nfl',
    'NCAAB': 'basketball_ncaab',
    'NCAAF': 'americanfootball_ncaaf',
    'WNBA': 'basketball_wnba',
  };
  return map[display] || display.toLowerCase();
}

export function TeamBetsDashboard() {
  const [selectedSport, setSelectedSport] = useState('ALL');
  const [selectedBetType, setSelectedBetType] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Auto-detect: default to NCAAB if no other sports have upcoming bets
  const { data: sportCounts } = useQuery({
    queryKey: ['team-bets-sport-counts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('game_bets')
        .select('sport')
        .eq('is_active', true)
        .gt('commence_time', new Date().toISOString());
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        const display = getSportDisplay(r.sport);
        counts[display] = (counts[display] || 0) + 1;
      });
      return counts;
    },
    staleTime: 60000,
  });

  // Default to NCAAB when it has games but NBA doesn't
  useEffect(() => {
    if (sportCounts && selectedSport === 'ALL') {
      if (sportCounts['NBA']) return;
      if (sportCounts['NCAAB']) { setSelectedSport('NCAAB'); return; }
      if (sportCounts['NHL']) { setSelectedSport('NHL'); return; }
    }
  }, [sportCounts]);

  // Fetch team bets (upcoming)
  const { data: bets, refetch, isLoading } = useQuery({
    queryKey: ['team-bets', selectedSport, selectedBetType],
    queryFn: async () => {
      let query = supabase
        .from('game_bets')
        .select('*')
        .eq('is_active', true)
        .gt('commence_time', new Date().toISOString())
        .order('commence_time', { ascending: true })
        .limit(100);

      if (selectedSport !== 'ALL') {
        query = query.eq('sport', getSportKey(selectedSport));
      }
      if (selectedBetType !== 'all') {
        query = query.eq('bet_type', selectedBetType);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Group by game_id to consolidate bookmaker data
      const gameMap = new Map<string, GameBet[]>();
      for (const bet of (data || [])) {
        const key = `${bet.game_id}_${bet.bet_type}`;
        if (!gameMap.has(key)) {
          gameMap.set(key, []);
        }
        gameMap.get(key)!.push(bet as GameBet);
      }
      
      // Return best line for each game/bet_type combo
      const consolidated: GameBet[] = [];
      for (const [, gameBets] of gameMap) {
        // Pick the bet with highest composite_score (fallback to sharp_score)
        const best = gameBets.reduce((a, b) => 
          ((b.composite_score || b.sharp_score || 0) > (a.composite_score || a.sharp_score || 0)) ? b : a
        );
        consolidated.push(best);
      }
      
      // Sort by composite_score DESC
      consolidated.sort((a, b) => (b.composite_score || b.sharp_score || 0) - (a.composite_score || a.sharp_score || 0));
      
      return consolidated;
    },
    refetchInterval: 60000,
  });

  // Fetch recent games when no upcoming bets exist
  const { data: recentBets } = useQuery({
    queryKey: ['team-bets-recent', selectedSport, selectedBetType],
    queryFn: async () => {
      let query = supabase
        .from('game_bets')
        .select('*')
        .order('commence_time', { ascending: false })
        .limit(10);

      if (selectedSport !== 'ALL') {
        query = query.eq('sport', getSportKey(selectedSport));
      }
      if (selectedBetType !== 'all') {
        query = query.eq('bet_type', selectedBetType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as GameBet[];
    },
    enabled: !isLoading && (!bets || bets.length === 0),
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Trigger signal detector
      const { error } = await supabase.functions.invoke('whale-signal-detector', {
        body: { include_team_props: true }
      });

      if (error) throw error;
      
      await refetch();
      toast.success('Team bets refreshed with latest signals');
    } catch (error) {
      console.error('Refresh error:', error);
      toast.error('Failed to refresh team bets');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Stats
  const totalBets = bets?.length || 0;
  const qualityBets = bets?.filter(b => (b.composite_score || b.sharp_score || 0) >= 62).length || 0;
  const spreadBets = bets?.filter(b => b.bet_type === 'spread').length || 0;
  const totalBets2 = bets?.filter(b => b.bet_type === 'total').length || 0;

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Team Bets
          </h1>
          <p className="text-muted-foreground text-sm">
            Spreads, totals & moneylines with sharp signals
          </p>
        </div>
        <Button 
          onClick={handleRefresh} 
          disabled={isRefreshing}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Detecting...' : 'Refresh'}
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card/50">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold">{totalBets}</div>
            <div className="text-xs text-muted-foreground">Total Bets</div>
          </CardContent>
        </Card>
        <Card className="bg-primary/10 border-primary/20">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-primary">{qualityBets}</div>
            <div className="text-xs text-muted-foreground">Quality Picks (62+)</div>
          </CardContent>
        </Card>
        <Card className="bg-chart-2/10 border-chart-2/20">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-chart-2">{spreadBets}</div>
            <div className="text-xs text-muted-foreground">Spreads</div>
          </CardContent>
        </Card>
        <Card className="bg-chart-4/10 border-chart-4/20">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-chart-4">{totalBets2}</div>
            <div className="text-xs text-muted-foreground">Totals</div>
          </CardContent>
        </Card>
      </div>

      {/* Sport Tabs */}
      <Tabs value={selectedSport} onValueChange={setSelectedSport}>
        <TabsList className="w-full overflow-x-auto flex-nowrap justify-start">
          {SPORTS.map(sport => (
            <TabsTrigger key={sport} value={sport} className="min-w-fit">
              {sport}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Bet Type Filter */}
      <div className="flex flex-wrap gap-2">
        {BET_TYPES.map(type => {
          const Icon = type.icon;
          const isActive = selectedBetType === type.id;
          return (
            <Button
              key={type.id}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedBetType(type.id)}
              className="gap-1"
            >
              <Icon className="h-3 w-3" />
              {type.label}
            </Button>
          );
        })}
      </div>

      {/* Bets List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Active Bets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading bets...
              </div>
            ) : bets?.length === 0 ? (
              <div className="space-y-4">
                <div className="text-center py-4 text-muted-foreground">
                  <p className="font-medium">No upcoming games available</p>
                  <p className="text-xs mt-1">The odds data source may need to be refreshed. Try clicking Refresh above.</p>
                </div>
                {recentBets && recentBets.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2">Recent Games</h3>
                    <div className="space-y-2">
                      {recentBets.map((bet) => (
                        <TeamBetCard key={bet.id} bet={bet} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                <div className="space-y-2">
                  {bets?.map((bet, index) => (
                    <motion.div
                      key={bet.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ delay: index * 0.02 }}
                    >
                      <TeamBetCard bet={bet} />
                    </motion.div>
                  ))}
                </div>
              </AnimatePresence>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
