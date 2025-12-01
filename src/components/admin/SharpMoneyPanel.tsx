import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Zap, TrendingUp, TrendingDown, RefreshCw, Clock, User, Target, CheckCircle, XCircle, AlertTriangle, ThumbsUp, ThumbsDown } from 'lucide-react';
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
  // Classification fields
  movement_authenticity?: 'real' | 'fake' | 'uncertain' | null;
  authenticity_confidence?: number | null;
  recommendation?: 'pick' | 'fade' | 'caution' | null;
  recommendation_reason?: string | null;
  opposite_side_moved?: boolean | null;
  books_consensus?: number | null;
  // Final pick fields
  final_pick?: string | null;
  is_primary_record?: boolean | null;
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
      const authBadge = newMovement.movement_authenticity === 'real' ? '✅' : 
                        newMovement.movement_authenticity === 'fake' ? '🚨' : '⚠️';
      toast({
        title: `${authBadge} New Sharp Alert!`,
        description: `${newMovement.outcome_name}${playerInfo} - ${newMovement.recommendation?.toUpperCase() || 'CAUTION'}`,
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
      // Cast the data to handle the string -> union type conversion
      setMovements((data || []) as LineMovement[]);
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
        description: `Found ${data.movementsDetected} movements (${data.realSharpMoves || 0} real, ${data.fakeSharpMoves || 0} fake)`,
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

  const getAuthenticityBadge = (authenticity: string | null | undefined) => {
    if (authenticity === 'real') {
      return (
        <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">
          <CheckCircle className="w-3 h-3 mr-1" />
          REAL
        </Badge>
      );
    }
    if (authenticity === 'fake') {
      return (
        <Badge variant="destructive" className="bg-red-500/20 text-red-400 border-red-500/30">
          <XCircle className="w-3 h-3 mr-1" />
          FAKE
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
        <AlertTriangle className="w-3 h-3 mr-1" />
        UNCERTAIN
      </Badge>
    );
  };

  const getRecommendationBadge = (recommendation: string | null | undefined) => {
    if (recommendation === 'pick') {
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
          <ThumbsUp className="w-3 h-3 mr-1" />
          PICK
        </Badge>
      );
    }
    if (recommendation === 'fade') {
      return (
        <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
          <ThumbsDown className="w-3 h-3 mr-1" />
          FADE
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
        <AlertTriangle className="w-3 h-3 mr-1" />
        CAUTION
      </Badge>
    );
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
    if (activeTab === 'real') return m.movement_authenticity === 'real';
    if (activeTab === 'fade') return m.movement_authenticity === 'fake';
    if (activeTab === 'props') return isPlayerProp(m);
    if (activeTab === 'games') return !isPlayerProp(m);
    return true;
  });

  const sharpMovements = movements.filter(m => m.is_sharp_action);
  const realSharpMovements = movements.filter(m => m.movement_authenticity === 'real');
  const fakeSharpMovements = movements.filter(m => m.movement_authenticity === 'fake');
  const playerPropMovements = movements.filter(m => isPlayerProp(m));

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
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <p className="text-2xl font-bold text-green-500">{realSharpMovements.length}</p>
            </div>
            <p className="text-xs text-muted-foreground">Real Sharp</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <XCircle className="w-4 h-4 text-red-500" />
              <p className="text-2xl font-bold text-red-500">{fakeSharpMovements.length}</p>
            </div>
            <p className="text-xs text-muted-foreground">Fake/Trap</p>
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
      </div>

      {/* Tabs for filtering */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="real" className="text-green-500">
            <CheckCircle className="w-3 h-3 mr-1" />
            Real
          </TabsTrigger>
          <TabsTrigger value="fade" className="text-red-500">
            <XCircle className="w-3 h-3 mr-1" />
            Fade
          </TabsTrigger>
          <TabsTrigger value="sharp">
            <Zap className="w-3 h-3 mr-1" />
            All Sharp
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
                <Card 
                  key={movement.id} 
                  className={
                    movement.movement_authenticity === 'real' 
                      ? 'border-green-500/50 bg-green-500/5' 
                      : movement.movement_authenticity === 'fake'
                        ? 'border-red-500/50 bg-red-500/5'
                        : movement.is_sharp_action 
                          ? 'border-yellow-500/50 bg-yellow-500/5' 
                          : ''
                  }
                >
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

                        {/* AI Betting Rule Badges */}
                        {movement.is_sharp_action && (
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {getAuthenticityBadge(movement.movement_authenticity)}
                            {getRecommendationBadge(movement.recommendation)}
                            {movement.books_consensus && movement.books_consensus > 1 && (
                              <Badge variant="outline" className="text-xs">
                                {movement.books_consensus} books
                              </Badge>
                            )}
                            {/* AI Knowledge Rule Badges */}
                            {movement.recommendation_reason?.includes('LINE_AND_JUICE') && (
                              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">
                                ✅ Line+Juice
                              </Badge>
                            )}
                            {movement.recommendation_reason?.includes('LATE_MONEY_SWEET_SPOT') && (
                              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">
                                🕐 1-3hr Sweet Spot
                              </Badge>
                            )}
                            {movement.recommendation_reason?.includes('PRICE_ONLY') && (
                              <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">
                                ❌ Price-Only Trap
                              </Badge>
                            )}
                            {movement.recommendation_reason?.includes('EARLY_MORNING') && (
                              <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
                                🌅 Morning Trap
                              </Badge>
                            )}
                            {movement.recommendation_reason?.includes('STEAM_MOVE_NO_CONSENSUS') && (
                              <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">
                                🚨 Single Book Steam
                              </Badge>
                            )}
                            {movement.recommendation_reason?.includes('MULTI_BOOK') && (
                              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">
                                📚 Multi-Book Consensus
                              </Badge>
                            )}
                          </div>
                        )}

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
                        
                        {/* FINAL PICK - Prominently displayed */}
                        {movement.final_pick && movement.is_sharp_action && (
                          <div className="mt-2 p-2 rounded-md border bg-primary/5 border-primary/30">
                            <div className="flex items-center gap-2">
                              <Target className="w-4 h-4 text-primary" />
                              <span className="font-bold text-primary text-sm">
                                FINAL PICK: {movement.final_pick}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {movement.movement_authenticity === 'real' 
                                ? '✅ Following verified sharp action'
                                : movement.movement_authenticity === 'fake'
                                  ? '👎 Fading fake/trap movement'
                                  : '⚠️ Proceed with caution'
                              }
                            </p>
                          </div>
                        )}
                        
                        {/* Fallback outcome name if no final pick */}
                        {!movement.final_pick && (
                          <p className="font-medium text-sm mt-1">
                            {movement.outcome_name}
                          </p>
                        )}

                        {/* Recommendation reason */}
                        {movement.recommendation_reason && (
                          <p className="text-xs text-muted-foreground mt-2 italic">
                            {movement.recommendation_reason}
                          </p>
                        )}

                        {/* Sharp indicator (legacy) */}
                        {movement.is_sharp_action && movement.sharp_indicator && !movement.recommendation_reason && (
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
                        {movement.authenticity_confidence !== null && movement.authenticity_confidence !== undefined && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {Math.round(movement.authenticity_confidence * 100)}% conf
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
