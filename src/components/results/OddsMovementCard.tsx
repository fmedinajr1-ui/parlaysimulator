import { useState, useEffect } from "react";
import { FeedCard } from "../FeedCard";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Zap, AlertTriangle, Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

interface LineMovement {
  id: string;
  event_id: string;
  sport: string;
  description: string;
  bookmaker: string;
  market_type: string;
  outcome_name: string;
  old_price: number;
  new_price: number;
  old_point?: number;
  new_point?: number;
  price_change: number;
  point_change?: number;
  is_sharp_action: boolean;
  sharp_indicator?: string;
  detected_at: string;
  commence_time?: string;
}

interface OddsMovementCardProps {
  delay?: number;
  compact?: boolean;
  sportFilter?: string;
  showSharpOnly?: boolean;
}

export function OddsMovementCard({ 
  delay = 0, 
  compact = false, 
  sportFilter,
  showSharpOnly = false
}: OddsMovementCardProps) {
  const [movements, setMovements] = useState<LineMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchMovements = async () => {
    try {
      let query = (supabase as any)
        .from('line_movements')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(compact ? 5 : 15);

      if (showSharpOnly) {
        query = query.eq('is_sharp_action', true);
      }

      if (sportFilter) {
        query = query.eq('sport', sportFilter);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching movements:', error);
        return;
      }

      setMovements(data || []);
    } catch (err) {
      console.error('Failed to fetch movements:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMovements();
  }, [sportFilter, showSharpOnly]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await supabase.functions.invoke('track-odds-movement', {
        body: { sports: ['NBA', 'NFL', 'NCAAB'], action: 'fetch' }
      });
      await fetchMovements();
    } catch (err) {
      console.error('Failed to refresh:', err);
      setIsRefreshing(false);
    }
  };

  const formatOdds = (price: number) => {
    return price > 0 ? `+${price}` : `${price}`;
  };

  const getMovementColor = (change: number) => {
    if (change > 0) return 'text-neon-green';
    if (change < 0) return 'text-neon-red';
    return 'text-muted-foreground';
  };

  const getBookmakerName = (key: string) => {
    const names: Record<string, string> = {
      'fanduel': 'FanDuel',
      'draftkings': 'DraftKings',
      'betmgm': 'BetMGM',
      'caesars': 'Caesars'
    };
    return names[key] || key;
  };

  if (isLoading) {
    return (
      <FeedCard delay={delay}>
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </FeedCard>
    );
  }

  if (movements.length === 0 && !isLoading) {
    return (
      <FeedCard delay={delay}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-purple" />
            {showSharpOnly ? 'Sharp Money Alerts' : 'Line Movements'}
          </p>
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground text-center py-4">
          No {showSharpOnly ? 'sharp money alerts' : 'line movements'} detected yet
        </p>
      </FeedCard>
    );
  }

  return (
    <FeedCard delay={delay}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          {showSharpOnly ? (
            <>
              <Zap className="w-4 h-4 text-neon-yellow" />
              Sharp Money Alerts
            </>
          ) : (
            <>
              <Activity className="w-4 h-4 text-neon-purple" />
              Line Movements
            </>
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="space-y-2">
        {movements.map((movement) => (
          <div 
            key={movement.id}
            className={`p-3 rounded-lg border transition-all ${
              movement.is_sharp_action 
                ? 'bg-neon-yellow/10 border-neon-yellow/30' 
                : 'bg-muted/50 border-border/50'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">
                    {movement.sport}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {getBookmakerName(movement.bookmaker)}
                  </Badge>
                  {movement.is_sharp_action && (
                    <Badge className="text-xs bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30">
                      <Zap className="w-3 h-3 mr-1" />
                      SHARP
                    </Badge>
                  )}
                </div>
                <p className="text-sm font-medium text-foreground truncate">
                  {movement.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {movement.outcome_name} ({movement.market_type})
                </p>
              </div>
              
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1 justify-end">
                  {movement.price_change > 0 ? (
                    <TrendingUp className="w-4 h-4 text-neon-green" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-neon-red" />
                  )}
                  <span className={`text-sm font-bold ${getMovementColor(movement.price_change)}`}>
                    {movement.price_change > 0 ? '+' : ''}{movement.price_change}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatOdds(movement.old_price)} → {formatOdds(movement.new_price)}
                </p>
                {movement.point_change !== null && movement.point_change !== undefined && Math.abs(movement.point_change) >= 0.5 && (
                  <p className="text-xs text-neon-orange">
                    Spread: {movement.old_point} → {movement.new_point}
                  </p>
                )}
              </div>
            </div>

            {movement.sharp_indicator && (
              <div className="mt-2 pt-2 border-t border-border/30">
                <p className="text-xs text-neon-yellow flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {movement.sharp_indicator}
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-1">
              {formatDistanceToNow(new Date(movement.detected_at), { addSuffix: true })}
            </p>
          </div>
        ))}
      </div>

      {!compact && movements.length > 0 && (
        <p className="text-xs text-muted-foreground text-center mt-3">
          Tracking odds from FanDuel, DraftKings, BetMGM & Caesars
        </p>
      )}
    </FeedCard>
  );
}

// Compact badge for showing in leg analysis
export function OddsMovementBadge({ 
  priceChange, 
  pointChange 
}: { 
  priceChange: number; 
  pointChange?: number;
}) {
  if (Math.abs(priceChange) < 3) return null;

  const isSharp = Math.abs(priceChange) >= 8;
  const direction = priceChange > 0 ? 'up' : 'down';

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      isSharp 
        ? 'bg-neon-yellow/20 text-neon-yellow border border-neon-yellow/30'
        : direction === 'up'
          ? 'bg-neon-green/20 text-neon-green border border-neon-green/30'
          : 'bg-neon-red/20 text-neon-red border border-neon-red/30'
    }`}>
      {direction === 'up' ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}
      <span>{priceChange > 0 ? '+' : ''}{priceChange}</span>
      {isSharp && <Zap className="w-3 h-3" />}
    </div>
  );
}
