import { useState, useEffect, useCallback, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OddsMovementCard } from "@/components/results/OddsMovementCard";
import { LineHistoryChart } from "@/components/odds/LineHistoryChart";
import { PushNotificationToggle } from "@/components/odds/PushNotificationToggle";
import { JuicedPropsCard } from "@/components/suggestions/JuicedPropsCard";
import { OddsPaywall } from "@/components/odds/OddsPaywall";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { PullToRefreshContainer, PullToRefreshIndicator } from "@/components/ui/pull-to-refresh";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Activity, Zap, TrendingUp, RefreshCw, Flame, ShoppingCart, Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { WolfAvatar } from "@/components/avatars/WolfAvatar";

const SPORTS = [
  { value: "all", label: "All Sports" },
  { value: "basketball_nba", label: "NBA" },
  { value: "americanfootball_nfl", label: "NFL" },
  { value: "basketball_ncaab", label: "NCAAB" },
  { value: "americanfootball_ncaaf", label: "NCAAF" },
  { value: "icehockey_nhl", label: "NHL" },
  { value: "baseball_mlb", label: "MLB" },
];

interface Stats {
  totalMovements: number;
  sharpAlerts: number;
  avgPriceChange: number;
}

const StatCard = memo(({ icon: Icon, label, value, className }: { 
  icon: React.ElementType; 
  label: string; 
  value: number; 
  className?: string;
}) => (
  <div className={`bg-card rounded-xl p-4 border border-border active:scale-95 transition-transform ${className}`}>
    <div className="flex items-center gap-2 mb-1">
      <Icon className="w-4 h-4" />
      <span className="text-xs text-muted-foreground uppercase">{label}</span>
    </div>
    <p className="text-2xl font-display">{value}</p>
  </div>
));

StatCard.displayName = 'StatCard';

const OddsMovement = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { hasOddsAccess, isLoading: subLoading, isAdmin, checkSubscription } = useSubscription();
  const { toast } = useToast();
  const { lightTap, success } = useHapticFeedback();
  
  const [selectedSport, setSelectedSport] = useState("all");
  const [stats, setStats] = useState<Stats>({ totalMovements: 0, sharpAlerts: 0, avgPriceChange: 0 });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Handle checkout success/cancel
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      toast({
        title: 'Welcome to Odds Tracker Pro!',
        description: 'Your subscription is now active.',
      });
      checkSubscription();
    } else if (searchParams.get('canceled') === 'true') {
      toast({
        title: 'Checkout canceled',
        description: 'No changes were made to your account.',
      });
    }
  }, [searchParams]);

  const fetchStats = useCallback(async () => {
    try {
      let query = supabase
        .from('line_movements')
        .select('*')
        .gte('detected_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (selectedSport !== "all") {
        query = query.eq('sport', selectedSport);
      }

      const { data, error } = await query;

      if (error) throw error;

      const movements = data || [];
      const sharpCount = movements.filter((m: any) => m.is_sharp_action).length;
      const avgChange = movements.length > 0 
        ? movements.reduce((sum: number, m: any) => sum + Math.abs(m.price_change), 0) / movements.length 
        : 0;

      if (movements.length > 0) {
        const mostRecent = movements.reduce((latest: any, m: any) => 
          new Date(m.detected_at) > new Date(latest.detected_at) ? m : latest
        );
        setLastUpdated(new Date(mostRecent.detected_at));
      }

      setStats({
        totalMovements: movements.length,
        sharpAlerts: sharpCount,
        avgPriceChange: Math.round(avgChange * 10) / 10
      });
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [selectedSport]);

  useEffect(() => {
    if (hasOddsAccess || isAdmin) {
      fetchStats();
    }
  }, [selectedSport, hasOddsAccess, isAdmin, fetchStats]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    lightTap();
    try {
      await supabase.functions.invoke('track-odds-movement', {
        body: { sports: ['NBA', 'NFL', 'NCAAB'], action: 'fetch' }
      });
      await fetchStats();
      success();
    } catch (err) {
      console.error('Failed to refresh:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchStats, lightTap, success]);

  const { pullProgress, containerRef, handlers } = usePullToRefresh({
    onRefresh: handleRefresh,
    threshold: 80,
  });

  // Show loading state
  if (subLoading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show paywall if user doesn't have access
  if (!hasOddsAccess && !isAdmin) {
    return (
      <div className="min-h-dvh bg-background pb-nav-safe">
        <MobileHeader 
          title="ODDS TRACKER" 
          subtitle="Premium Feature"
          showBack
        />
        <OddsPaywall onSubscribe={() => checkSubscription()} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background pb-nav-safe">
      <MobileHeader 
        title="ODDS TRACKER PRO"
        subtitle="Track line shifts & sharp money"
        icon={<WolfAvatar size="sm" variant="alpha" />}
        showBack
        rightAction={
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="icon" 
              onClick={() => { lightTap(); navigate('/line-shopping'); }}
              className="h-9 w-9"
            >
              <ShoppingCart className="w-4 h-4" />
            </Button>
            <Button 
              variant="outline" 
              size="icon" 
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-9 w-9"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        }
      />

      <PullToRefreshIndicator 
        pullProgress={pullProgress} 
        isRefreshing={isRefreshing} 
        threshold={80} 
      />

      <div 
        ref={containerRef}
        {...handlers}
        className="scroll-optimized"
        style={{ transform: `translateY(${Math.min(pullProgress * 0.5, 40)}px)` }}
      >
        <main className="max-w-4xl mx-auto px-3 py-4">
          {/* Sport Filter */}
          <div className="mb-6">
            <Select value={selectedSport} onValueChange={(v) => { lightTap(); setSelectedSport(v); }}>
              <SelectTrigger className="w-full md:w-48 bg-card border-border">
                <SelectValue placeholder="Select sport" />
              </SelectTrigger>
              <SelectContent>
                {SPORTS.map((sport) => (
                  <SelectItem key={sport.value} value={sport.value}>
                    {sport.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard 
              icon={Activity} 
              label="24h Moves" 
              value={stats.totalMovements}
              className="text-foreground"
            />
            <StatCard 
              icon={Zap} 
              label="Sharp" 
              value={stats.sharpAlerts}
              className="border-neon-yellow/30 text-neon-yellow"
            />
            <StatCard 
              icon={TrendingUp} 
              label="Avg Δ" 
              value={stats.avgPriceChange}
              className="text-foreground"
            />
          </div>

          {/* Push Notification Settings */}
          <div className="mb-6">
            <PushNotificationToggle />
          </div>

          {/* Main Content Tabs */}
          <Tabs defaultValue="movements" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4 bg-card">
              <TabsTrigger 
                value="movements" 
                className="data-[state=active]:bg-primary/20"
                onClick={lightTap}
              >
                <Activity className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">All</span>
              </TabsTrigger>
              <TabsTrigger 
                value="sharp" 
                className="data-[state=active]:bg-neon-yellow/20"
                onClick={lightTap}
              >
                <Zap className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Sharp</span>
              </TabsTrigger>
              <TabsTrigger 
                value="juiced" 
                className="data-[state=active]:bg-neon-orange/20"
                onClick={lightTap}
              >
                <Flame className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Props</span>
              </TabsTrigger>
              <TabsTrigger 
                value="charts" 
                className="data-[state=active]:bg-neon-green/20"
                onClick={lightTap}
              >
                <TrendingUp className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Charts</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="movements" className="space-y-4 content-visibility-auto">
              <OddsMovementCard 
                sportFilter={selectedSport !== "all" ? selectedSport : undefined} 
                delay={0}
                limit={15}
              />
            </TabsContent>

            <TabsContent value="sharp" className="space-y-4 content-visibility-auto">
              <OddsMovementCard 
                sportFilter={selectedSport !== "all" ? selectedSport : undefined}
                showSharpOnly
                delay={0}
                limit={10}
              />
            </TabsContent>

            <TabsContent value="juiced" className="space-y-4 content-visibility-auto">
              <JuicedPropsCard />
            </TabsContent>

            <TabsContent value="charts" className="space-y-4 content-visibility-auto">
              <LineHistoryChart 
                sportFilter={selectedSport !== "all" ? selectedSport : undefined}
              />
            </TabsContent>
          </Tabs>

          {/* Real-time indicator */}
          <div className="mt-6 flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
              <span className="text-xs text-muted-foreground">
                Auto-updates every 8 hours • Data from FanDuel, DraftKings, BetMGM & Caesars
              </span>
            </div>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground/70">
                Last updated: {lastUpdated.toLocaleString()}
              </span>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default OddsMovement;
