import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  History, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  TrendingUp,
  TrendingDown,
  Loader2,
  Trophy,
  Target
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface SuggestedLeg {
  description: string;
  odds: number;
  impliedProbability: number;
  sport: string;
  betType: string;
  eventTime: string;
}

interface FollowedSuggestion {
  id: string;
  suggested_parlay_id: string;
  parlay_history_id: string;
  outcome: boolean | null;
  stake: number;
  payout: number | null;
  created_at: string;
  settled_at: string | null;
  suggested_parlay?: {
    legs: SuggestedLeg[];
    total_odds: number;
    combined_probability: number;
    confidence_score: number;
    sport: string;
  };
}

interface AccuracyMetrics {
  sport: string;
  confidence_level: string;
  total_suggestions: number;
  total_won: number;
  total_lost: number;
  accuracy_rate: number;
  avg_odds: number;
  roi_percentage: number;
}

export const SuggestionHistoryFeed = () => {
  const { user } = useAuth();
  const [followed, setFollowed] = useState<FollowedSuggestion[]>([]);
  const [accuracyMetrics, setAccuracyMetrics] = useState<AccuracyMetrics[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "won" | "lost" | "pending">("all");

  useEffect(() => {
    if (user) {
      fetchHistory();
      fetchAccuracyMetrics();
      
      // Subscribe to realtime updates
      const channel = supabase
        .channel('suggestion-performance-updates')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'suggestion_performance',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchHistory();
            fetchAccuracyMetrics();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const fetchHistory = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('suggestion_performance')
        .select(`
          *,
          suggested_parlay:suggested_parlays (
            legs,
            total_odds,
            combined_probability,
            confidence_score,
            sport
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const typedData = (data || []).map(item => ({
        ...item,
        suggested_parlay: item.suggested_parlay ? {
          ...item.suggested_parlay,
          legs: item.suggested_parlay.legs as unknown as SuggestedLeg[],
        } : undefined,
      }));

      setFollowed(typedData);
    } catch (error) {
      console.error('Error fetching suggestion history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAccuracyMetrics = async () => {
    try {
      const { data, error } = await supabase.rpc('get_suggestion_accuracy_stats');
      if (error) throw error;
      setAccuracyMetrics(data || []);
    } catch (error) {
      console.error('Error fetching accuracy metrics:', error);
    }
  };

  const formatOdds = (odds: number) => odds > 0 ? `+${odds}` : odds.toString();

  const getOutcomeIcon = (outcome: boolean | null) => {
    if (outcome === true) return <CheckCircle2 className="w-5 h-5 text-neon-green" />;
    if (outcome === false) return <XCircle className="w-5 h-5 text-destructive" />;
    return <Clock className="w-5 h-5 text-neon-yellow" />;
  };

  const getOutcomeLabel = (outcome: boolean | null) => {
    if (outcome === true) return "Won";
    if (outcome === false) return "Lost";
    return "Pending";
  };

  const filteredSuggestions = followed.filter(s => {
    if (filter === "all") return true;
    if (filter === "won") return s.outcome === true;
    if (filter === "lost") return s.outcome === false;
    return s.outcome === null;
  });

  const stats = {
    total: followed.length,
    won: followed.filter(s => s.outcome === true).length,
    lost: followed.filter(s => s.outcome === false).length,
    pending: followed.filter(s => s.outcome === null).length,
    totalStaked: followed.reduce((sum, s) => sum + s.stake, 0),
    totalProfit: followed.reduce((sum, s) => {
      if (s.outcome === true && s.payout) return sum + (s.payout - s.stake);
      if (s.outcome === false) return sum - s.stake;
      return sum;
    }, 0),
  };

  const winRate = stats.won + stats.lost > 0 
    ? ((stats.won / (stats.won + stats.lost)) * 100).toFixed(1) 
    : "0";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Overview */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            SUGGESTION RECORD
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-neon-green">{stats.won}</p>
              <p className="text-xs text-muted-foreground">Won</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-destructive">{stats.lost}</p>
              <p className="text-xs text-muted-foreground">Lost</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-neon-yellow">{stats.pending}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div className="text-center">
              <p className={cn(
                "text-2xl font-bold",
                Number(winRate) >= 50 ? "text-neon-green" : "text-destructive"
              )}>
                {winRate}%
              </p>
              <p className="text-xs text-muted-foreground">Win Rate</p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
            <div>
              <p className="text-xs text-muted-foreground">Total Profit/Loss</p>
              <p className={cn(
                "text-lg font-bold flex items-center gap-1",
                stats.totalProfit >= 0 ? "text-neon-green" : "text-destructive"
              )}>
                {stats.totalProfit >= 0 ? (
                  <TrendingUp className="w-4 h-4" />
                ) : (
                  <TrendingDown className="w-4 h-4" />
                )}
                ${Math.abs(stats.totalProfit).toFixed(2)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Staked</p>
              <p className="text-lg font-bold">${stats.totalStaked.toFixed(2)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Accuracy by Sport */}
      {accuracyMetrics.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-display flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              AI ACCURACY BY SPORT
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {accuracyMetrics.slice(0, 5).map((metric, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {metric.sport}
                    </Badge>
                    <Badge variant="outline" className="text-xs capitalize">
                      {metric.confidence_level}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {metric.total_won}/{metric.total_suggestions}
                    </span>
                    <span className={cn(
                      "text-sm font-bold",
                      metric.accuracy_rate >= 50 ? "text-neon-green" : "text-destructive"
                    )}>
                      {metric.accuracy_rate.toFixed(0)}%
                    </span>
                    <span className={cn(
                      "text-xs",
                      metric.roi_percentage >= 0 ? "text-neon-green" : "text-destructive"
                    )}>
                      ROI: {metric.roi_percentage >= 0 ? '+' : ''}{metric.roi_percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter Tabs */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All ({stats.total})</TabsTrigger>
          <TabsTrigger value="won">Won ({stats.won})</TabsTrigger>
          <TabsTrigger value="lost">Lost ({stats.lost})</TabsTrigger>
          <TabsTrigger value="pending">Pending ({stats.pending})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* History List */}
      {filteredSuggestions.length === 0 ? (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="py-8 text-center">
            <History className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              {filter === "all" 
                ? "No followed suggestions yet. Analyze a suggestion to get started!"
                : `No ${filter} suggestions found.`
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredSuggestions.map((item) => (
            <Card key={item.id} className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {getOutcomeIcon(item.outcome)}
                    <div>
                      <p className="text-sm font-medium">
                        {item.suggested_parlay?.sport || 'Mixed'} Parlay
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(item.created_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                  <Badge 
                    variant={item.outcome === true ? "default" : item.outcome === false ? "destructive" : "secondary"}
                  >
                    {getOutcomeLabel(item.outcome)}
                  </Badge>
                </div>

                {item.suggested_parlay && (
                  <>
                    <div className="space-y-1.5 mb-3">
                      {item.suggested_parlay.legs.slice(0, 3).map((leg, index) => (
                        <div 
                          key={index}
                          className="text-xs bg-muted/30 rounded px-2 py-1 flex items-center justify-between"
                        >
                          <span className="truncate flex-1">{leg.description}</span>
                          <Badge variant="outline" className="ml-2 text-xs">
                            {formatOdds(leg.odds)}
                          </Badge>
                        </div>
                      ))}
                      {item.suggested_parlay.legs.length > 3 && (
                        <p className="text-xs text-muted-foreground text-center">
                          +{item.suggested_parlay.legs.length - 3} more legs
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-sm border-t border-border/30 pt-3">
                      <div>
                        <span className="text-muted-foreground">Stake: </span>
                        <span className="font-medium">${item.stake.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Odds: </span>
                        <span className="font-medium">{formatOdds(item.suggested_parlay.total_odds)}</span>
                      </div>
                      {item.outcome === true && item.payout && (
                        <div>
                          <span className="text-muted-foreground">Won: </span>
                          <span className="font-medium text-neon-green">
                            ${(item.payout - item.stake).toFixed(2)}
                          </span>
                        </div>
                      )}
                      {item.outcome === false && (
                        <div>
                          <span className="text-muted-foreground">Lost: </span>
                          <span className="font-medium text-destructive">
                            -${item.stake.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
