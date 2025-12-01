import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Zap, TrendingUp, TrendingDown, RefreshCw, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  price_change: number;
  point_change: number | null;
  is_sharp_action: boolean;
  sharp_indicator: string | null;
  detected_at: string;
  commence_time: string | null;
}

export function SharpMoneyPanel() {
  const [movements, setMovements] = useState<LineMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTracking, setIsTracking] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchMovements();
  }, []);

  const fetchMovements = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('line_movements')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setMovements(data || []);
    } catch (err) {
      console.error('Error fetching movements:', err);
      toast({
        title: "Error",
        description: "Failed to load line movements",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const triggerOddsTracking = async () => {
    setIsTracking(true);
    try {
      const { data, error } = await supabase.functions.invoke('track-odds-movement', {
        body: { action: 'fetch' }
      });

      if (error) throw error;

      toast({
        title: "Odds Tracking Complete",
        description: `Created ${data.snapshotsCreated} snapshots, detected ${data.movementsDetected} movements`
      });

      fetchMovements();
    } catch (err) {
      console.error('Error tracking odds:', err);
      toast({
        title: "Error",
        description: "Failed to track odds movements",
        variant: "destructive"
      });
    } finally {
      setIsTracking(false);
    }
  };

  const formatOdds = (odds: number) => {
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  const getMovementColor = (change: number) => {
    if (Math.abs(change) >= 15) return 'text-red-500';
    if (Math.abs(change) >= 10) return 'text-orange-500';
    if (Math.abs(change) >= 5) return 'text-yellow-500';
    return 'text-muted-foreground';
  };

  const getSharpBadgeVariant = (indicator: string | null) => {
    if (!indicator) return 'outline';
    if (indicator.includes('STEAM')) return 'destructive';
    if (indicator.includes('SHARP ACTION')) return 'default';
    return 'secondary';
  };

  const sharpMovements = movements.filter(m => m.is_sharp_action);
  const recentMovements = movements.slice(0, 20);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Actions */}
      <div className="flex gap-2">
        <Button 
          onClick={triggerOddsTracking} 
          disabled={isTracking}
          className="flex-1"
        >
          {isTracking ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Tracking...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Track Odds Now
            </>
          )}
        </Button>
        <Button variant="outline" onClick={fetchMovements}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{movements.length}</p>
            <p className="text-xs text-muted-foreground">Total Movements</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary">{sharpMovements.length}</p>
            <p className="text-xs text-muted-foreground">Sharp Actions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-yellow-500">
              {movements.filter(m => m.sharp_indicator?.includes('STEAM')).length}
            </p>
            <p className="text-xs text-muted-foreground">Steam Moves</p>
          </CardContent>
        </Card>
      </div>

      {/* Sharp Money Alerts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            Sharp Money Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sharpMovements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No sharp money alerts detected yet. Click "Track Odds Now" to scan for movements.
            </p>
          ) : (
            sharpMovements.slice(0, 10).map((movement) => (
              <div 
                key={movement.id} 
                className="p-3 bg-muted/50 rounded-lg border border-border"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {movement.sport}
                    </Badge>
                    <Badge 
                      variant={getSharpBadgeVariant(movement.sharp_indicator)}
                      className="text-xs"
                    >
                      {movement.sharp_indicator?.split(' - ')[0] || 'SHARP'}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(movement.detected_at).toLocaleTimeString()}
                  </span>
                </div>
                
                <p className="text-sm font-medium mb-1">{movement.outcome_name}</p>
                <p className="text-xs text-muted-foreground mb-2">{movement.description}</p>
                
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{formatOdds(movement.old_price)}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className={getMovementColor(movement.price_change)}>
                    {formatOdds(movement.new_price)}
                  </span>
                  <span className={`ml-auto flex items-center gap-1 ${getMovementColor(movement.price_change)}`}>
                    {movement.price_change < 0 ? (
                      <TrendingDown className="w-4 h-4" />
                    ) : (
                      <TrendingUp className="w-4 h-4" />
                    )}
                    {movement.price_change > 0 ? '+' : ''}{movement.price_change}
                  </span>
                </div>
                
                {movement.point_change !== null && movement.point_change !== 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Point change: {movement.point_change > 0 ? '+' : ''}{movement.point_change}
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Recent All Movements */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-muted-foreground" />
            Recent Line Movements
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentMovements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No line movements recorded yet.
            </p>
          ) : (
            recentMovements.map((movement) => (
              <div 
                key={movement.id} 
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs shrink-0">
                      {movement.sport}
                    </Badge>
                    {movement.is_sharp_action && (
                      <Zap className="w-3 h-3 text-yellow-500 shrink-0" />
                    )}
                    <span className="text-xs text-muted-foreground truncate">
                      {movement.bookmaker}
                    </span>
                  </div>
                  <p className="text-sm truncate">{movement.outcome_name}</p>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className={`text-sm font-medium ${getMovementColor(movement.price_change)}`}>
                    {movement.price_change > 0 ? '+' : ''}{movement.price_change}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatOdds(movement.old_price)} → {formatOdds(movement.new_price)}
                  </p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
