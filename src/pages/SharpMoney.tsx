import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedCard, FeedCardHeader } from "@/components/FeedCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, AlertTriangle, Filter, Zap, RefreshCw, Target } from "lucide-react";
import { SharpAccuracyTracker } from "@/components/sharp/SharpAccuracyTracker";
import { PersonalSharpTracker } from "@/components/sharp/PersonalSharpTracker";
import { FollowButton } from "@/components/sharp/FollowButton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";
import { AppShell } from "@/components/layout/AppShell";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { SportTabs, QuickFilter } from "@/components/ui/sport-tabs";
import { StatsCard, StatItem, StatsGrid } from "@/components/ui/stats-card";
import { SkeletonList } from "@/components/ui/skeleton-card";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullToRefreshContainer } from "@/components/ui/pull-to-refresh";

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
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");

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

  const fetchMovements = useCallback(async () => {
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
  }, []);

  // Pull to refresh
  const { isRefreshing, pullProgress, containerRef, handlers } = usePullToRefresh({
    onRefresh: fetchMovements,
  });

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
    
    // Confidence filter
    if (confidenceFilter !== "all") {
      const confidence = m.authenticity_confidence ?? 0;
      if (confidenceFilter === "60" && confidence < 0.6) return false;
      if (confidenceFilter === "70" && confidence < 0.7) return false;
      if (confidenceFilter === "80" && confidence < 0.8) return false;
    }
    
    return true;
  });

  const uniqueSports = Array.from(new Set(movements.map(m => m.sport))).sort();
  
  const stats = {
    total: movements.length,
    sharp: movements.filter(m => m.is_sharp_action).length,
    picks: movements.filter(m => getRecommendation(m).type === 'pick').length,
    fades: movements.filter(m => getRecommendation(m).type === 'fade').length,
    highConfidence: movements.filter(m => (m.authenticity_confidence ?? 0) >= 0.6).length,
  };

  const sportTabs = [
    { id: "all", label: "All", count: stats.total },
    ...uniqueSports.map(sport => ({ id: sport, label: sport }))
  ];

  return (
    <AppShell noPadding>
      <MobileHeader 
        title="Sharp Money"
        subtitle="Real-time PICK/FADE signals"
        icon={<Zap className="w-6 h-6 text-neon-yellow" />}
        rightAction={
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={fetchMovements}
            disabled={isRefreshing}
            className="h-9 w-9"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        }
      />

      <PullToRefreshContainer
        containerRef={containerRef}
        handlers={handlers}
        pullProgress={pullProgress}
        isRefreshing={isRefreshing}
        className="flex-1 overflow-y-auto"
      >
        <div className="px-4 py-4 space-y-4">
        {/* Stats Grid - FanDuel style */}
        <StatsCard variant="glass">
          <StatsGrid columns={4}>
            <StatItem label="Moves" value={stats.total} size="sm" />
            <StatItem label="Sharp" value={stats.sharp} size="sm" />
            <StatItem label="Picks" value={stats.picks} size="sm" />
            <StatItem label="Fades" value={stats.fades} size="sm" />
          </StatsGrid>
        </StatsCard>

        {/* Accuracy Tracker */}
        <SharpAccuracyTracker />

        {/* Personal Record Tracker */}
        <PersonalSharpTracker />

        {/* Sport Tabs - Horizontal scroll */}
        <SportTabs
          tabs={sportTabs}
          activeTab={sportFilter}
          onTabChange={setSportFilter}
        />

        {/* Quick Filters */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          <QuickFilter 
            label="Picks" 
            icon="✅" 
            active={recommendationFilter === "pick"}
            onClick={() => setRecommendationFilter(recommendationFilter === "pick" ? "all" : "pick")}
            variant="success"
          />
          <QuickFilter 
            label="Fades" 
            icon="❌" 
            active={recommendationFilter === "fade"}
            onClick={() => setRecommendationFilter(recommendationFilter === "fade" ? "all" : "fade")}
            variant="danger"
          />
          <QuickFilter 
            label="Sharp Only" 
            icon="⚡" 
            active={authenticityFilter === "sharp"}
            onClick={() => setAuthenticityFilter(authenticityFilter === "sharp" ? "all" : "sharp")}
            variant="warning"
          />
          <QuickFilter 
            label="60%+" 
            icon="🎯" 
            active={confidenceFilter === "60"}
            onClick={() => setConfidenceFilter(confidenceFilter === "60" ? "all" : "60")}
            variant="default"
          />
        </div>

        {/* Filters */}
        <FeedCard delay={100}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="w-4 h-4" />
              <span className="uppercase tracking-wider">Filters</span>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              
              <div>
                <label className="text-xs text-muted-foreground uppercase mb-1 block">Confidence</label>
                <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="60">🎯 60%+</SelectItem>
                    <SelectItem value="70">🔥 70%+</SelectItem>
                    <SelectItem value="80">💎 80%+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {(sportFilter !== "all" || recommendationFilter !== "all" || authenticityFilter !== "all" || confidenceFilter !== "all") && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {
                  setSportFilter("all");
                  setRecommendationFilter("all");
                  setAuthenticityFilter("all");
                  setConfidenceFilter("all");
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </FeedCard>

        {/* Movements Feed */}
        {loading ? (
          <SkeletonList count={5} variant="bet" />
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
                    
                    {/* Confidence Meter */}
                    {movement.authenticity_confidence !== null && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                            <Target className="w-3 h-3" />
                            Confidence
                          </span>
                          <span className={`text-sm font-bold ${
                            movement.authenticity_confidence >= 0.8 ? 'text-neon-green' :
                            movement.authenticity_confidence >= 0.6 ? 'text-neon-yellow' :
                            'text-neon-red'
                          }`}>
                            {(movement.authenticity_confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${
                              movement.authenticity_confidence >= 0.8 ? 'bg-neon-green' :
                              movement.authenticity_confidence >= 0.6 ? 'bg-neon-yellow' :
                              'bg-neon-red'
                            }`}
                            style={{ width: `${movement.authenticity_confidence * 100}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>Low</span>
                          <span>Medium</span>
                          <span>High</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Sharp Signals */}
                    {movement.sharp_indicator && (
                      <div className="flex items-center gap-2 flex-wrap">
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
                      </div>
                    )}
                    
                    {/* Follow Button and Timestamp */}
                    <div className="flex items-center justify-between pt-2 border-t border-border/30">
                      <FollowButton movementId={movement.id} />
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(movement.detected_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </FeedCard>
              );
            })}
          </div>
        )}
        </div>
      </PullToRefreshContainer>
    </AppShell>
  );
}
