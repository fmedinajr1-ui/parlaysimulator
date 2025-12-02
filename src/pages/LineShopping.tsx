import { useState, useEffect } from "react";
import { BottomNav } from "@/components/BottomNav";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, TrendingUp, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LineComparisonTable } from "@/components/odds/LineComparisonTable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SPORTS = [
  { value: "basketball_nba", label: "NBA" },
  { value: "americanfootball_nfl", label: "NFL" },
  { value: "basketball_ncaab", label: "NCAAB" },
  { value: "americanfootball_ncaaf", label: "NCAAF" },
  { value: "icehockey_nhl", label: "NHL" },
  { value: "baseball_mlb", label: "MLB" },
];

const MARKET_TYPES = [
  { value: "spreads", label: "Spreads" },
  { value: "totals", label: "Totals" },
  { value: "h2h", label: "Moneyline" },
];

interface GameOption {
  event_id: string;
  description: string;
  commence_time: string;
}

const LineShopping = () => {
  const navigate = useNavigate();
  const [selectedSport, setSelectedSport] = useState("basketball_nba");
  const [selectedMarket, setSelectedMarket] = useState("spreads");
  const [selectedGame, setSelectedGame] = useState<string>("");
  const [games, setGames] = useState<GameOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchGames = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('odds_snapshots')
        .select('event_id, away_team, home_team, commence_time')
        .eq('sport', selectedSport)
        .eq('market_type', selectedMarket)
        .gte('commence_time', new Date().toISOString())
        .order('commence_time', { ascending: true });

      if (error) throw error;

      // Deduplicate games by event_id
      const uniqueGames = Array.from(
        new Map(
          (data || []).map((game) => [
            game.event_id,
            {
              event_id: game.event_id,
              description: `${game.away_team} @ ${game.home_team}`,
              commence_time: game.commence_time,
            },
          ])
        ).values()
      );

      setGames(uniqueGames);
      if (uniqueGames.length > 0 && !selectedGame) {
        setSelectedGame(uniqueGames[0].event_id);
      }
    } catch (err) {
      console.error('Failed to fetch games:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGames();
  }, [selectedSport, selectedMarket]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await supabase.functions.invoke('track-odds-movement', {
        body: { sports: ['NBA', 'NFL', 'NCAAB'], action: 'fetch' }
      });
      await fetchGames();
    } catch (err) {
      console.error('Failed to refresh:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background pb-nav-safe touch-pan-y overflow-x-safe">
      <main className="max-w-7xl mx-auto px-3 py-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate(-1)}
            className="shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-display text-foreground">LINE SHOPPING</h1>
            <p className="text-sm text-muted-foreground">Compare odds across all bookmakers</p>
          </div>
          <Button 
            variant="outline" 
            size="icon" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-neon-purple" />
              Select Game & Market
            </CardTitle>
            <CardDescription>
              Find the best odds across all major sportsbooks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Sport
                </label>
                <Select value={selectedSport} onValueChange={setSelectedSport}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="Select sport" />
                  </SelectTrigger>
                  <SelectContent>
                    {SPORTS.map((sport) => (
                      <SelectItem key={sport.value} value={sport.value}>
                        {sport.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Market Type
                </label>
                <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="Select market" />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKET_TYPES.map((market) => (
                      <SelectItem key={market.value} value={market.value}>
                        {market.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Game
                </label>
                <Select value={selectedGame} onValueChange={setSelectedGame} disabled={loading}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="Select game" />
                  </SelectTrigger>
                  <SelectContent>
                    {games.map((game) => (
                      <SelectItem key={game.event_id} value={game.event_id}>
                        <div className="flex flex-col">
                          <span>{game.description}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(game.commence_time).toLocaleDateString()} at{' '}
                            {new Date(game.commence_time).toLocaleTimeString([], { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Comparison Table */}
        {loading ? (
          <Card>
            <CardContent className="p-6">
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </CardContent>
          </Card>
        ) : selectedGame ? (
          <LineComparisonTable
            eventId={selectedGame}
            sport={selectedSport}
            marketType={selectedMarket}
          />
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground">
                No games available for the selected sport and market
              </p>
            </CardContent>
          </Card>
        )}

        {/* Footer Info */}
        <div className="mt-6 flex items-center justify-center gap-2">
          <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
          <span className="text-xs text-muted-foreground">
            Live odds • FanDuel, DraftKings, BetMGM, Caesars & more
          </span>
        </div>
      </main>

      <BottomNav />
    </div>
  );
};

export default LineShopping;
