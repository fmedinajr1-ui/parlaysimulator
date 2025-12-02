import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";

interface OddsSnapshot {
  id: string;
  event_id: string;
  sport: string;
  away_team: string;
  home_team: string;
  bookmaker: string;
  market_type: string;
  outcome_name: string;
  price: number;
  point: number | null;
  snapshot_time: string;
}

export const LineShoppingPanel = () => {
  const [snapshots, setSnapshots] = useState<OddsSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSport, setSelectedSport] = useState<string>("all");
  const [sports, setSports] = useState<string[]>([]);

  useEffect(() => {
    fetchOddsData();
  }, [selectedSport]);

  const fetchOddsData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('odds_snapshots')
        .select('*')
        .in('sport', ['basketball_nba', 'americanfootball_nfl'])
        .neq('player_name', null)
        .order('snapshot_time', { ascending: false })
        .limit(100);

      if (selectedSport !== "all") {
        query = query.eq('sport', selectedSport);
      }

      const { data, error } = await query;

      if (error) throw error;

      setSnapshots(data || []);

      // Set fixed sports for NBA and NFL
      setSports(['basketball_nba', 'americanfootball_nfl']);
    } catch (error) {
      console.error('Error fetching odds:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatOdds = (price: number) => {
    return price > 0 ? `+${price}` : `${price}`;
  };

  const groupedByGame = snapshots.reduce((acc, snap) => {
    const key = `${snap.event_id}-${snap.market_type}`;
    if (!acc[key]) {
      acc[key] = {
        event_id: snap.event_id,
        sport: snap.sport,
        matchup: `${snap.away_team} @ ${snap.home_team}`,
        market_type: snap.market_type,
        snapshots: []
      };
    }
    acc[key].snapshots.push(snap);
    return acc;
  }, {} as Record<string, any>);

  const games = Object.values(groupedByGame).slice(0, 20);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Line Shopping Data</CardTitle>
              <CardDescription>Recent odds snapshots across bookmakers</CardDescription>
            </div>
            <Select value={selectedSport} onValueChange={setSelectedSport}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by sport" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Props</SelectItem>
                <SelectItem value="basketball_nba">NBA</SelectItem>
                <SelectItem value="americanfootball_nfl">NFL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : games.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No odds data available</p>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4">
                {games.map((game, idx) => (
                  <Card key={idx} className="bg-muted/30">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">{game.matchup}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-1">
                            {game.sport === 'basketball_nba' ? 'NBA' : 'NFL'} • {game.market_type}
                          </p>
                        </div>
                        <Badge variant="outline">{game.snapshots[0]?.player_name}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Bookmaker</TableHead>
                            <TableHead>Outcome</TableHead>
                            <TableHead>Odds</TableHead>
                            <TableHead>Point</TableHead>
                            <TableHead>Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {game.snapshots.map((snap: OddsSnapshot) => (
                            <TableRow key={snap.id}>
                              <TableCell className="font-medium">{snap.bookmaker}</TableCell>
                              <TableCell>{snap.outcome_name}</TableCell>
                              <TableCell>
                                <span className={snap.price > 0 ? "text-neon-green" : "text-neon-red"}>
                                  {formatOdds(snap.price)}
                                </span>
                              </TableCell>
                              <TableCell>
                                {snap.point !== null ? (
                                  <span>{snap.point > 0 ? `+${snap.point}` : snap.point}</span>
                                ) : '-'}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {new Date(snap.snapshot_time).toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stats Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Total Snapshots</p>
              <p className="text-2xl font-bold">{snapshots.length}</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Unique Games</p>
              <p className="text-2xl font-bold">{games.length}</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Bookmakers</p>
              <p className="text-2xl font-bold">
                {Array.from(new Set(snapshots.map(s => s.bookmaker))).length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
