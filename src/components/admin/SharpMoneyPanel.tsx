import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Zap, TrendingUp, TrendingDown, RefreshCw, Clock, User, Target } from 'lucide-react';
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
  old_point?: number | null;
  new_point?: number | null;
  is_sharp_action: boolean;
  sharp_indicator: string | null;
  detected_at: string;
  commence_time: string | null;
  player_name?: string | null;
}

const MARKET_LABELS: Record<string, string> = {
  'player_points': 'PTS',
  'player_rebounds': 'REB',
  'player_assists': 'AST',
  'player_threes': '3PM',
  'player_points_rebounds_assists': 'PRA',
  'spreads': 'Spread',
  'h2h': 'ML',
  'totals': 'Total'
};

export function SharpMoneyPanel() {
  const [movements, setMovements] = useState<LineMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTracking, setIsTracking] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [newAlertCount, setNewAlertCount] = useState(0);
  const [activeTab, setActiveTab] = useState('all');
  const { toast } = useToast();

  const handleNewMovement = useCallback((payload: { new: LineMovement }) => {
    const newMovement = payload.new;
    
    setMovements(prev => {
      if (prev.some(m => m.id === newMovement.id)) return prev;
      return [newMovement, ...prev].slice(0, 100);
    });
    
    if (newMovement.is_sharp_action) {
      setNewAlertCount(prev => prev + 1);
      const playerInfo = newMovement.player_name ? ` (${newMovement.player_name})` : '';
      toast({
        title: "⚡ New Sharp Alert!",
        description: `${newMovement.outcome_name}${playerInfo} - ${newMovement.sharp_indicator?.split(' - ')[0] || 'Sharp Action'}`,
      });
    }
  }, [toast]);

  useEffect(() => {
    fetchMovements();

    const channel = supabase
      .channel('line-movements-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'line_movements'
        },
        handleNewMovement
      )
      .subscribe((status) => {
        setIsLive(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleNewMovement]);

  const fetchMovements = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('line_movements')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(100);

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
        body: { 
          sports: ['NBA', 'NFL', 'NCAAB'],
          includePlayerProps: true
        }
      });

      if (error) throw error;

      toast({
        title: "Tracking Complete",
        description: `Found ${data.movementsDetected} movements (${data.sharpAlerts} sharp, ${data.playerPropMovements || 0} player props)`,
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

  const getSharpBadgeVariant = (indicator: string | null): "default" | "secondary" | "destructive" | "outline" => {
    if (!indicator) return 'outline';
    if (indicator.includes('STEAM')) return 'destructive';
    if (indicator.includes('SHARP ACTION')) return 'default';
    return 'secondary';
  };

  const getMarketLabel = (marketType: string) => {
    return MARKET_LABELS[marketType] || marketType;
  };

  const isPlayerProp = (movement: LineMovement) => {
    return !!movement.player_name || movement.market_type.startsWith('player_');
  };

  // Filter movements based on tab
  const filteredMovements = movements.filter(m => {
    if (activeTab === 'all') return true;
    if (activeTab === 'sharp') return m.is_sharp_action;
    if (activeTab === 'props') return isPlayerProp(m);
    if (activeTab === 'games') return !isPlayerProp(m);
    return true;
  });

  const sharpMovements = movements.filter(m => m.is_sharp_action);
  const playerPropMovements = movements.filter(m => isPlayerProp(m));
  const sharpPropMovements = movements.filter(m => m.is_sharp_action && isPlayerProp(m));

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
              <Zap className="w-4 h-4 mr-2" />
              Track Now (+ Props)
            </>
          )}
        </Button>
        <Button variant="outline" onClick={fetchMovements}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Live Status Indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
          <span className="text-xs text-muted-foreground">
            {isLive ? 'Live updates enabled' : 'Connecting...'}
          </span>
        </div>
        {newAlertCount > 0 && (
          <Badge 
            variant="destructive" 
            className="cursor-pointer"
            onClick={() => setNewAlertCount(0)}
          >
            {newAlertCount} new alert{newAlertCount > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{movements.length}</p>
            <p className="text-xs text-muted-foreground">Total Moves</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-destructive">{sharpMovements.length}</p>
            <p className="text-xs text-muted-foreground">Sharp Alerts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <User className="w-4 h-4 text-primary" />
              <p className="text-2xl font-bold text-primary">{playerPropMovements.length}</p>
            </div>
            <p className="text-xs text-muted-foreground">Player Props</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Zap className="w-4 h-4 text-orange-500" />
              <p className="text-2xl font-bold text-orange-500">{sharpPropMovements.length}</p>
            </div>
            <p className="text-xs text-muted-foreground">Sharp Props</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for filtering */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="sharp">
            <Zap className="w-3 h-3 mr-1" />
            Sharp
          </TabsTrigger>
          <TabsTrigger value="props">
            <User className="w-3 h-3 mr-1" />
            Props
          </TabsTrigger>
          <TabsTrigger value="games">
            <Target className="w-3 h-3 mr-1" />
            Games
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {filteredMovements.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8 text-muted-foreground">
                No movements found. Click "Track Now" to scan for line movements.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filteredMovements.map((movement) => (
                <Card key={movement.id} className={movement.is_sharp_action ? 'border-destructive/50 bg-destructive/5' : ''}>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* Header with badges */}
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge variant="outline" className="text-xs">
                            {movement.sport}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {getMarketLabel(movement.market_type)}
                          </Badge>
                          <Badge variant="outline" className="text-xs capitalize">
                            {movement.bookmaker}
                          </Badge>
                          {isPlayerProp(movement) && (
                            <Badge variant="default" className="text-xs bg-primary">
                              <User className="w-3 h-3 mr-1" />
                              Prop
                            </Badge>
                          )}
                        </div>

                        {/* Player name if prop */}
                        {movement.player_name && (
                          <div className="font-semibold text-primary flex items-center gap-1 mb-1">
                            <User className="w-4 h-4" />
                            {movement.player_name}
                          </div>
                        )}

                        {/* Game/Outcome info */}
                        <p className="text-sm text-muted-foreground truncate">
                          {movement.description}
                        </p>
                        <p className="font-medium text-sm mt-1">
                          {movement.outcome_name}
                        </p>

                        {/* Sharp indicator */}
                        {movement.is_sharp_action && movement.sharp_indicator && (
                          <div className="flex items-center gap-1 mt-2">
                            <Zap className="w-3 h-3 text-destructive" />
                            <span className="text-xs text-destructive font-medium">
                              {movement.sharp_indicator}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Price movement */}
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-sm text-muted-foreground">
                            {formatOdds(movement.old_price)}
                          </span>
                          {movement.price_change > 0 ? (
                            <TrendingUp className="w-4 h-4 text-green-500" />
                          ) : (
                            <TrendingDown className="w-4 h-4 text-red-500" />
                          )}
                          <span className={`text-sm font-bold ${getMovementColor(movement.price_change)}`}>
                            {formatOdds(movement.new_price)}
                          </span>
                        </div>
                        <div className={`text-xs ${getMovementColor(movement.price_change)}`}>
                          {movement.price_change > 0 ? '+' : ''}{movement.price_change} pts
                        </div>
                        {movement.point_change !== null && Math.abs(movement.point_change) >= 0.5 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Line: {movement.old_point} → {movement.new_point}
                          </div>
                        )}
                        <div className="flex items-center gap-1 justify-end mt-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {new Date(movement.detected_at).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
