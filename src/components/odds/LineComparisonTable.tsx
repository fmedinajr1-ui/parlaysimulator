import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Star, Trophy } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LineShoppingCalculator } from "./LineShoppingCalculator";

interface LineComparisonTableProps {
  eventId: string;
  sport: string;
  marketType: string;
}

interface OddsData {
  bookmaker: string;
  outcome_name: string;
  price: number;
  point?: number;
  snapshot_time: string;
}

interface ComparisonRow {
  outcome: string;
  odds: Record<string, { price: number; point?: number; isBest: boolean; edge: number }>;
}

const formatOdds = (price: number): string => {
  return price > 0 ? `+${price}` : `${price}`;
};

const calculateEdge = (price: number, bestPrice: number): number => {
  // Convert American odds to implied probability and calculate edge
  const toProb = (odds: number) => {
    if (odds > 0) return 100 / (odds + 100);
    return Math.abs(odds) / (Math.abs(odds) + 100);
  };
  
  const currentProb = toProb(price);
  const bestProb = toProb(bestPrice);
  
  return ((1 / currentProb - 1 / bestProb) * 100);
};

export const LineComparisonTable = ({ eventId, sport, marketType }: LineComparisonTableProps) => {
  const [data, setData] = useState<ComparisonRow[]>([]);
  const [bookmakers, setBookmakers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [gameInfo, setGameInfo] = useState<{ away: string; home: string } | null>(null);

  useEffect(() => {
    const fetchComparison = async () => {
      setLoading(true);
      try {
        const { data: snapshots, error } = await supabase
          .from('odds_snapshots')
          .select('*')
          .eq('event_id', eventId)
          .eq('sport', sport)
          .eq('market_type', marketType)
          .order('snapshot_time', { ascending: false });

        if (error) throw error;

        if (!snapshots || snapshots.length === 0) {
          setData([]);
          setBookmakers([]);
          setLoading(false);
          return;
        }

        // Set game info
        if (snapshots[0]) {
          setGameInfo({
            away: snapshots[0].away_team,
            home: snapshots[0].home_team,
          });
        }

        // Get unique bookmakers
        const uniqueBookmakers = Array.from(new Set(snapshots.map(s => s.bookmaker))).sort();
        setBookmakers(uniqueBookmakers);

        // Group by outcome
        const outcomeMap = new Map<string, OddsData[]>();
        snapshots.forEach((snap) => {
          if (!outcomeMap.has(snap.outcome_name)) {
            outcomeMap.set(snap.outcome_name, []);
          }
          outcomeMap.get(snap.outcome_name)!.push({
            bookmaker: snap.bookmaker,
            outcome_name: snap.outcome_name,
            price: snap.price,
            point: snap.point,
            snapshot_time: snap.snapshot_time,
          });
        });

        // Build comparison rows
        const rows: ComparisonRow[] = [];
        outcomeMap.forEach((oddsArray, outcome) => {
          // Get most recent odds for each bookmaker
          const latestByBook = new Map<string, OddsData>();
          oddsArray.forEach((odds) => {
            const existing = latestByBook.get(odds.bookmaker);
            if (!existing || new Date(odds.snapshot_time) > new Date(existing.snapshot_time)) {
              latestByBook.set(odds.bookmaker, odds);
            }
          });

          // Find best price (most positive for bettor)
          let bestPrice = -Infinity;
          latestByBook.forEach((odds) => {
            if (odds.price > bestPrice) {
              bestPrice = odds.price;
            }
          });

          // Build odds object
          const oddsRecord: Record<string, { price: number; point?: number; isBest: boolean; edge: number }> = {};
          uniqueBookmakers.forEach((book) => {
            const odds = latestByBook.get(book);
            if (odds) {
              const isBest = odds.price === bestPrice;
              const edge = calculateEdge(odds.price, bestPrice);
              oddsRecord[book] = {
                price: odds.price,
                point: odds.point,
                isBest,
                edge,
              };
            }
          });

          rows.push({
            outcome,
            odds: oddsRecord,
          });
        });

        setData(rows);
      } catch (err) {
        console.error('Failed to fetch comparison:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchComparison();
  }, [eventId, sport, marketType]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-center text-muted-foreground">Loading comparison...</p>
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-center text-muted-foreground">No odds data available for this game</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-neon-yellow" />
              <span>Odds Comparison</span>
            </div>
            {gameInfo && (
              <Badge variant="outline" className="text-xs">
                {gameInfo.away} @ {gameInfo.home}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
        <ScrollArea className="w-full">
          <div className="min-w-[800px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold w-[150px]">Outcome</TableHead>
                  {bookmakers.map((book) => (
                    <TableHead key={book} className="text-center font-bold">
                      {book}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.outcome}>
                    <TableCell className="font-medium">{row.outcome}</TableCell>
                    {bookmakers.map((book) => {
                      const odds = row.odds[book];
                      if (!odds) {
                        return (
                          <TableCell key={book} className="text-center text-muted-foreground">
                            -
                          </TableCell>
                        );
                      }

                      return (
                        <TableCell key={book} className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            <div className={`flex items-center gap-1 ${odds.isBest ? 'text-neon-green font-bold' : ''}`}>
                              {odds.isBest && <Star className="w-3 h-3 fill-current" />}
                              {odds.point !== null && odds.point !== undefined && (
                                <span className="text-xs">
                                  {odds.point > 0 ? `+${odds.point}` : odds.point}
                                </span>
                              )}
                              <span>{formatOdds(odds.price)}</span>
                            </div>
                            {!odds.isBest && odds.edge !== 0 && (
                              <Badge 
                                variant="outline" 
                                className="text-[10px] px-1 py-0 h-4 border-neon-red/30 text-neon-red"
                              >
                                <TrendingDown className="w-2 h-2 mr-0.5" />
                                {Math.abs(odds.edge).toFixed(1)}%
                              </Badge>
                            )}
                            {odds.isBest && (
                              <Badge 
                                variant="outline" 
                                className="text-[10px] px-1 py-0 h-4 border-neon-green/30 text-neon-green"
                              >
                                BEST
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 text-neon-green fill-current" />
              <span>Best odds available</span>
            </div>
            <div className="flex items-center gap-1">
              <TrendingDown className="w-3 h-3 text-neon-red" />
              <span>Edge difference from best</span>
            </div>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="h-4 px-1 text-[10px]">+7</Badge>
              <span>Point spread</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

      {data.length > 0 && (
        <LineShoppingCalculator
          bookmakerOdds={bookmakers
            .map(book => {
              const odds = data[0]?.odds[book];
              if (!odds) return null;
              return {
                bookmaker: book,
                price: odds.price,
                point: odds.point
              };
            })
            .filter(Boolean) as { bookmaker: string; price: number; point?: number }[]}
          outcomeName={data[0]?.outcome || ""}
        />
      )}
    </div>
  );
};
