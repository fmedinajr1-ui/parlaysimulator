import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedCard } from "@/components/FeedCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine } from "recharts";
import { format } from "date-fns";
import { Activity, TrendingUp, Clock } from "lucide-react";

interface OddsSnapshot {
  id: string;
  event_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  bookmaker: string;
  market_type: string;
  outcome_name: string;
  price: number;
  point?: number;
  snapshot_time: string;
  commence_time?: string;
}

interface LineHistoryChartProps {
  sportFilter?: string;
}

interface ChartDataPoint {
  time: string;
  timestamp: number;
  [key: string]: string | number;
}

const chartConfig = {
  fanduel: {
    label: "FanDuel",
    color: "hsl(var(--neon-green))",
  },
  draftkings: {
    label: "DraftKings",
    color: "hsl(var(--neon-purple))",
  },
  betmgm: {
    label: "BetMGM",
    color: "hsl(var(--neon-yellow))",
  },
  caesars: {
    label: "Caesars",
    color: "hsl(var(--neon-cyan))",
  },
} satisfies ChartConfig;

export function LineHistoryChart({ sportFilter }: LineHistoryChartProps) {
  const [snapshots, setSnapshots] = useState<OddsSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [events, setEvents] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    const fetchSnapshots = async () => {
      try {
        let query = supabase
          .from('odds_snapshots')
          .select('*')
          .order('snapshot_time', { ascending: true })
          .gte('snapshot_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        if (sportFilter) {
          query = query.eq('sport', sportFilter);
        }

        const { data, error } = await query;

        if (error) throw error;

        const snapshotData = data || [];
        setSnapshots(snapshotData);

        // Extract unique events
        const uniqueEvents = new Map<string, string>();
        snapshotData.forEach((s: OddsSnapshot) => {
          if (!uniqueEvents.has(s.event_id)) {
            uniqueEvents.set(s.event_id, `${s.away_team} @ ${s.home_team}`);
          }
        });

        const eventsList = Array.from(uniqueEvents).map(([id, label]) => ({ id, label }));
        setEvents(eventsList);

        if (eventsList.length > 0 && !selectedEvent) {
          setSelectedEvent(eventsList[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch snapshots:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSnapshots();
  }, [sportFilter]);

  const getChartData = (): ChartDataPoint[] => {
    if (!selectedEvent) return [];

    const eventSnapshots = snapshots.filter(s => s.event_id === selectedEvent);
    
    // Group by time and bookmaker
    const timeGroups = new Map<string, ChartDataPoint>();
    
    eventSnapshots.forEach(s => {
      const timeKey = format(new Date(s.snapshot_time), 'HH:mm');
      const existing = timeGroups.get(timeKey) || { 
        time: timeKey, 
        timestamp: new Date(s.snapshot_time).getTime() 
      };
      
      existing[s.bookmaker] = s.price;
      timeGroups.set(timeKey, existing);
    });

    return Array.from(timeGroups.values()).sort((a, b) => a.timestamp - b.timestamp);
  };

  const chartData = getChartData();
  const bookmakers = [...new Set(snapshots.filter(s => s.event_id === selectedEvent).map(s => s.bookmaker))];

  if (isLoading) {
    return (
      <FeedCard>
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      </FeedCard>
    );
  }

  if (snapshots.length === 0) {
    return (
      <FeedCard>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity className="w-12 h-12 text-muted-foreground mb-3" />
          <p className="text-lg font-medium text-foreground mb-1">No Line History Yet</p>
          <p className="text-sm text-muted-foreground">
            Start tracking odds to see historical line movements
          </p>
        </div>
      </FeedCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Event Selector */}
      <FeedCard>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-neon-green" />
            Line History
          </p>
          <Badge variant="outline" className="text-xs">
            <Clock className="w-3 h-3 mr-1" />
            24h
          </Badge>
        </div>

        <Select value={selectedEvent || ""} onValueChange={setSelectedEvent}>
          <SelectTrigger className="w-full bg-muted/50 border-border">
            <SelectValue placeholder="Select a game" />
          </SelectTrigger>
          <SelectContent>
            {events.map((event) => (
              <SelectItem key={event.id} value={event.id}>
                {event.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FeedCard>

      {/* Chart */}
      {selectedEvent && chartData.length > 0 && (
        <FeedCard>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {bookmakers.map((book) => (
              <Badge 
                key={book} 
                variant="outline" 
                className="text-xs"
                style={{ 
                  borderColor: chartConfig[book as keyof typeof chartConfig]?.color || 'hsl(var(--border))',
                  color: chartConfig[book as keyof typeof chartConfig]?.color || 'hsl(var(--foreground))'
                }}
              >
                {chartConfig[book as keyof typeof chartConfig]?.label || book}
              </Badge>
            ))}
          </div>

          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis 
                dataKey="time" 
                stroke="hsl(var(--muted-foreground))" 
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))" 
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => value > 0 ? `+${value}` : `${value}`}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
              <ChartTooltip 
                content={<ChartTooltipContent />}
                cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
              />
              {bookmakers.map((book) => (
                <Line
                  key={book}
                  type="monotone"
                  dataKey={book}
                  stroke={chartConfig[book as keyof typeof chartConfig]?.color || 'hsl(var(--foreground))'}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5, strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ChartContainer>

          <p className="text-xs text-muted-foreground text-center mt-3">
            Odds movement over time (American odds format)
          </p>
        </FeedCard>
      )}

      {/* Movement Summary */}
      {selectedEvent && (
        <FeedCard>
          <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">
            Movement Summary
          </p>
          <div className="grid grid-cols-2 gap-3">
            {bookmakers.map((book) => {
              const bookSnapshots = snapshots
                .filter(s => s.event_id === selectedEvent && s.bookmaker === book)
                .sort((a, b) => new Date(a.snapshot_time).getTime() - new Date(b.snapshot_time).getTime());
              
              if (bookSnapshots.length < 2) return null;

              const first = bookSnapshots[0];
              const last = bookSnapshots[bookSnapshots.length - 1];
              const change = last.price - first.price;

              return (
                <div 
                  key={book}
                  className="bg-muted/50 rounded-lg p-3 border border-border/50"
                >
                  <p className="text-xs text-muted-foreground mb-1">
                    {chartConfig[book as keyof typeof chartConfig]?.label || book}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-lg font-bold ${
                      change > 0 ? 'text-neon-green' : change < 0 ? 'text-neon-red' : 'text-foreground'
                    }`}>
                      {change > 0 ? '+' : ''}{change}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({first.price > 0 ? '+' : ''}{first.price} → {last.price > 0 ? '+' : ''}{last.price})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </FeedCard>
      )}
    </div>
  );
}
