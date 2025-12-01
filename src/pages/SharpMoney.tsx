import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { FeedCard } from "@/components/FeedCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, AlertTriangle, Filter, Zap } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";

interface LineMovement {
  id: string;
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
  recommendation: string | null;
  recommendation_reason: string | null;
  movement_authenticity: string | null;
  authenticity_confidence: number | null;
  detected_at: string;
  commence_time: string | null;
}

const recommendationColors = {
  pick: "bg-neon-green/20 text-neon-green border-neon-green/30",
  fade: "bg-neon-red/20 text-neon-red border-neon-red/30",
  caution: "bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30",
};

const recommendationEmojis = {
  pick: "✅",
  fade: "❌",
  caution: "⚠️",
};

export default function SharpMoney() {
  const [movements, setMovements] = useState<LineMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [recommendationFilter, setRecommendationFilter] = useState<string>("all");
  const [authenticityFilter, setAuthenticityFilter] = useState<string>("all");

  useEffect(() => {
    fetchMovements();
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('line_movements_sharp')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'line_movements',
        },
        (payload) => {
          setMovements(prev => [payload.new as LineMovement, ...prev].slice(0, 200));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchMovements = async () => {
    try {
      const { data, error } = await supabase
        .from('line_movements')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      setMovements(data || []);
    } catch (error) {
      console.error('Error fetching movements:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatOdds = (odds: number) => {
    return odds > 0 ? `+${odds}` : `${odds}`;
  };

  const getBookmakerName = (bookmaker: string) => {
    const map: Record<string, string> = {
      draftkings: "DK",
      fanduel: "FD",
      betmgm: "MGM",
      caesars: "CZR",
      pointsbet: "PB",
    };
    return map[bookmaker.toLowerCase()] || bookmaker.slice(0, 3).toUpperCase();
  };

  const getRecommendation = (movement: LineMovement): { type: 'pick' | 'fade' | 'caution', label: string } => {
    if (movement.recommendation) {
      const rec = movement.recommendation.toLowerCase();
      if (rec === 'pick' || rec === 'bet' || rec === 'follow') return { type: 'pick', label: 'PICK' };
      if (rec === 'fade' || rec === 'avoid') return { type: 'fade', label: 'FADE' };
    }
    
    if (movement.movement_authenticity === 'real' && movement.is_sharp_action) {
      return { type: 'pick', label: 'PICK' };
    }
    
    if (movement.movement_authenticity === 'fake' || movement.movement_authenticity === 'trap') {
      return { type: 'fade', label: 'FADE' };
    }
    
    return { type: 'caution', label: 'CAUTION' };
  };

  // Filter movements
  const filteredMovements = movements.filter(m => {
    if (sportFilter !== "all" && m.sport !== sportFilter) return false;
    
    if (recommendationFilter !== "all") {
      const rec = getRecommendation(m);
      if (rec.type !== recommendationFilter) return false;
    }
    
    if (authenticityFilter !== "all") {
      if (authenticityFilter === "sharp" && !m.is_sharp_action) return false;
      if (authenticityFilter === "real" && m.movement_authenticity !== "real") return false;
      if (authenticityFilter === "fake" && m.movement_authenticity !== "fake") return false;
    }
    
    return true;
  });

  const uniqueSports = Array.from(new Set(movements.map(m => m.sport))).sort();
  
  const stats = {
    total: movements.length,
    sharp: movements.filter(m => m.is_sharp_action).length,
    picks: movements.filter(m => getRecommendation(m).type === 'pick').length,
    fades: movements.filter(m => getRecommendation(m).type === 'fade').length,
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="container max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-4xl font-black text-foreground flex items-center gap-2">
            <Zap className="w-8 h-8 text-neon-yellow" />
            Sharp Money
          </h1>
          <p className="text-muted-foreground">
            Real-time line movements with PICK/FADE recommendations
          </p>
        </div>

        {/* Stats */}
        <FeedCard delay={0}>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground uppercase">Total Moves</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-neon-yellow">{stats.sharp}</p>
              <p className="text-xs text-muted-foreground uppercase">Sharp</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-neon-green">{stats.picks}</p>
              <p className="text-xs text-muted-foreground uppercase">Picks</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-neon-red">{stats.fades}</p>
              <p className="text-xs text-muted-foreground uppercase">Fades</p>
            </div>
          </div>
        </FeedCard>

        {/* Filters */}
        <FeedCard delay={100}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="w-4 h-4" />
              <span className="uppercase tracking-wider">Filters</span>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground uppercase mb-1 block">Sport</label>
                <Select value={sportFilter} onValueChange={setSportFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sports</SelectItem>
                    {uniqueSports.map(sport => (
                      <SelectItem key={sport} value={sport}>{sport}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-xs text-muted-foreground uppercase mb-1 block">Recommendation</label>
                <Select value={recommendationFilter} onValueChange={setRecommendationFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pick">✅ Pick</SelectItem>
                    <SelectItem value="fade">❌ Fade</SelectItem>
                    <SelectItem value="caution">⚠️ Caution</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-xs text-muted-foreground uppercase mb-1 block">Authenticity</label>
                <Select value={authenticityFilter} onValueChange={setAuthenticityFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="sharp">Sharp Only</SelectItem>
                    <SelectItem value="real">Real</SelectItem>
                    <SelectItem value="fake">Fake/Trap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {(sportFilter !== "all" || recommendationFilter !== "all" || authenticityFilter !== "all") && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {
                  setSportFilter("all");
                  setRecommendationFilter("all");
                  setAuthenticityFilter("all");
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </FeedCard>

        {/* Movements Feed */}
        {loading ? (
          <FeedCard delay={200}>
            <div className="text-center py-8 text-muted-foreground">
              Loading movements...
            </div>
          </FeedCard>
        ) : filteredMovements.length === 0 ? (
          <FeedCard delay={200}>
            <div className="text-center py-8 text-muted-foreground">
              No movements found with current filters
            </div>
          </FeedCard>
        ) : (
          <div className="space-y-3">
            {filteredMovements.map((movement, idx) => {
              const rec = getRecommendation(movement);
              const priceUp = movement.price_change > 0;
              
              return (
                <FeedCard key={movement.id} delay={Math.min(200 + idx * 50, 800)}>
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {movement.sport}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {getBookmakerName(movement.bookmaker)}
                          </Badge>
                          {movement.is_sharp_action && (
                            <Badge className="text-xs bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30">
                              <Zap className="w-3 h-3 mr-1" />
                              SHARP
                            </Badge>
                          )}
                        </div>
                        <p className="font-medium text-foreground text-sm leading-tight">
                          {movement.description}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {movement.market_type} • {movement.outcome_name}
                        </p>
                      </div>
                      
                      <div className={`px-3 py-1.5 rounded-lg border text-center shrink-0 ${recommendationColors[rec.type]}`}>
                        <div className="text-lg font-bold">
                          {recommendationEmojis[rec.type]}
                        </div>
                        <div className="text-xs font-bold uppercase">
                          {rec.label}
                        </div>
                      </div>
                    </div>
                    
                    {/* Price Movement */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase mb-1">From</p>
                          <p className="text-lg font-bold text-foreground">{formatOdds(movement.old_price)}</p>
                        </div>
                        <div className={priceUp ? "text-neon-green" : "text-neon-red"}>
                          {priceUp ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase mb-1">To</p>
                          <p className={`text-lg font-bold ${priceUp ? "text-neon-green" : "text-neon-red"}`}>
                            {formatOdds(movement.new_price)}
                          </p>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <p className={`text-2xl font-bold ${priceUp ? "text-neon-green" : "text-neon-red"}`}>
                          {priceUp ? "+" : ""}{movement.price_change}
                        </p>
                        <p className="text-xs text-muted-foreground">points</p>
                      </div>
                    </div>
                    
                    {/* Analysis */}
                    {movement.recommendation_reason && (
                      <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                        <p className="text-xs text-muted-foreground uppercase mb-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Analysis
                        </p>
                        <p className="text-sm text-foreground">{movement.recommendation_reason}</p>
                      </div>
                    )}
                    
                    {/* Sharp Signals */}
                    {movement.sharp_indicator && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground uppercase">Signals:</span>
                        <Badge variant="outline" className="text-xs">
                          {movement.sharp_indicator}
                        </Badge>
                        {movement.movement_authenticity && (
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${
                              movement.movement_authenticity === 'real' 
                                ? 'border-neon-green/30 text-neon-green' 
                                : 'border-neon-red/30 text-neon-red'
                            }`}
                          >
                            {movement.movement_authenticity.toUpperCase()}
                          </Badge>
                        )}
                        {movement.authenticity_confidence !== null && (
                          <span className="text-xs text-muted-foreground">
                            {(movement.authenticity_confidence * 100).toFixed(0)}% confidence
                          </span>
                        )}
                      </div>
                    )}
                    
                    {/* Timestamp */}
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(movement.detected_at), { addSuffix: true })}
                    </p>
                  </div>
                </FeedCard>
              );
            })}
          </div>
        )}
      </div>
      
      <BottomNav />
    </div>
  );
}
