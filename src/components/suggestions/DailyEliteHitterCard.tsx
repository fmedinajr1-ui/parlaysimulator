import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/ui/carousel';
import { Crown, Target, Zap, TrendingUp, RefreshCw, Trophy, Sparkles, Info, ChevronDown, ChevronUp, AlertTriangle, BarChart3, History, Medal } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useSubscription } from '@/hooks/useSubscription';
import { EliteHitterPaywall } from './EliteHitterPaywall';
import { EliteHitterPerformance } from './EliteHitterPerformance';
import { EliteHitterHistory } from './EliteHitterHistory';

interface LegData {
  playerName: string;
  propType: string;
  line: number;
  side: string;
  odds: number;
  sport: string;
  p_leg: number;
  edge: number;
  engines: string[];
  gameDescription?: string;
}

interface EliteParlay {
  id: string;
  parlay_date: string;
  legs: LegData[];
  slip_score: number;
  combined_probability: number;
  total_edge: number;
  total_odds: number;
  sports: string[];
  source_engines: string[];
  outcome: string;
  selection_rationale?: string;
  engine_consensus?: Array<{ leg: string; playerName: string; engines: string[]; confidence: number }>;
  rank?: number;
}

const sportEmojis: Record<string, string> = {
  'NBA': '🏀',
  'NFL': '🏈',
  'NHL': '🏒',
  'MLB': '⚾',
  'basketball_nba': '🏀',
  'americanfootball_nfl': '🏈',
  'icehockey_nhl': '🏒',
  'baseball_mlb': '⚾',
};

const engineColors: Record<string, string> = {
  'MedianLock': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'HitRate': 'bg-green-500/20 text-green-400 border-green-500/30',
  'Sharp': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'PVS': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'Fatigue': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

// Rank badge component
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <Badge className="bg-gradient-to-r from-yellow-500 to-amber-500 text-black text-[10px] px-2 py-0.5 gap-1">
        <Crown className="w-3 h-3" />
        #1 Pick
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px] px-2 py-0.5 gap-1">
      <Medal className="w-3 h-3" />
      #{rank}
    </Badge>
  );
}

// Parlay content component for reuse in carousel
function ParlayContent({ 
  parlay, 
  showRationale, 
  setShowRationale 
}: { 
  parlay: EliteParlay; 
  showRationale: boolean;
  setShowRationale: (show: boolean) => void;
}) {
  const combinedProbPercent = (parlay.combined_probability * 100).toFixed(1);
  const legs = parlay.legs || [];
  const meetsQualityStandards = parlay.combined_probability >= 0.15 && 
    legs.every(leg => leg.p_leg >= 0.55);

  return (
    <div className="space-y-3">
      {/* Rank Badge */}
      <div className="flex items-center justify-between">
        <RankBadge rank={parlay.rank || 1} />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Slip Score:</span>
          <span className="font-mono">{parlay.slip_score?.toFixed(2)}</span>
        </div>
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <Target className="w-4 h-4 text-green-500" />
          <span className="text-muted-foreground">Prob:</span>
          <span className={cn(
            "font-semibold",
            parlay.combined_probability >= 0.20 ? "text-green-500" : 
            parlay.combined_probability >= 0.15 ? "text-yellow-500" : "text-red-500"
          )}>{combinedProbPercent}%</span>
        </div>
        <div className="flex items-center gap-1">
          <TrendingUp className="w-4 h-4 text-blue-500" />
          <span className="text-muted-foreground">Odds:</span>
          <span className="font-semibold text-blue-500">
            {parlay.total_odds > 0 ? '+' : ''}{Math.round(parlay.total_odds)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Zap className="w-4 h-4 text-yellow-500" />
          <span className="text-muted-foreground">Edge:</span>
          <span className="font-semibold text-yellow-500">+{parlay.total_edge?.toFixed(1)}%</span>
        </div>
      </div>
      
      {/* Quality Warning */}
      {!meetsQualityStandards && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
          <AlertTriangle className="w-4 h-4 text-yellow-500" />
          <span className="text-xs text-yellow-500">Limited high-quality picks available</span>
        </div>
      )}

      {/* Why These Picks */}
      {parlay.selection_rationale && (
        <Collapsible open={showRationale} onOpenChange={setShowRationale}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground hover:text-foreground">
              <span className="flex items-center gap-1">
                <Info className="w-3 h-3" />
                Why These Picks?
              </span>
              {showRationale ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="px-2 pb-2">
            <p className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
              {parlay.selection_rationale}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
      
      {/* Legs */}
      {legs.map((leg, idx) => (
        <div key={idx} className="p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{sportEmojis[leg.sport] || '🎯'}</span>
                <span className="font-medium text-sm truncate">{leg.playerName}</span>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-[10px] px-1.5 py-0",
                    leg.side === 'over' ? 'text-green-500 border-green-500/30' : 'text-red-500 border-red-500/30'
                  )}
                >
                  {leg.side.toUpperCase()}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {leg.propType} {leg.line} ({leg.odds > 0 ? '+' : ''}{leg.odds})
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className={cn(
                "text-sm font-semibold",
                leg.p_leg >= 0.70 ? "text-green-500" :
                leg.p_leg >= 0.55 ? "text-yellow-500" : "text-red-500"
              )}>
                {(leg.p_leg * 100).toFixed(0)}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                +{leg.edge?.toFixed(1)}% edge
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-1 mt-2">
            {leg.engines?.map((engine, eIdx) => (
              <Badge 
                key={eIdx} 
                variant="outline" 
                className={cn("text-[10px] px-1.5 py-0", engineColors[engine] || '')}
              >
                {engine}
              </Badge>
            ))}
          </div>
        </div>
      ))}

      {/* Outcome badge */}
      {parlay.outcome !== 'pending' && (
        <div className={cn(
          "flex items-center justify-center gap-2 p-3 rounded-lg",
          parlay.outcome === 'won' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        )}>
          <Trophy className="w-5 h-5" />
          <span className="font-semibold">{parlay.outcome === 'won' ? 'HIT!' : 'MISS'}</span>
        </div>
      )}
    </div>
  );
}

export function DailyEliteHitterCard() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(0);
  const { toast } = useToast();
  const { hasEliteHitterAccess, isAdmin, isLoading: isSubscriptionLoading } = useSubscription();

  const { data: parlays, isLoading, refetch } = useQuery({
    queryKey: ['daily-elite-parlays'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('daily_elite_parlays')
        .select('*')
        .eq('parlay_date', today)
        .order('rank', { ascending: true });
      
      if (error) throw error;
      if (!data || data.length === 0) return null;
      
      return data.map(p => ({
        ...p,
        legs: (p.legs || []) as unknown as LegData[],
        sports: (p.sports || []) as unknown as string[],
        source_engines: (p.source_engines || []) as unknown as string[],
        engine_consensus: (p.engine_consensus || []) as unknown as EliteParlay['engine_consensus'],
        rank: p.rank || 1,
      })) as EliteParlay[];
    },
    staleTime: 1000 * 60 * 5,
  });

  // Carousel navigation
  useEffect(() => {
    if (!carouselApi) return;
    
    setCurrentSlide(carouselApi.selectedScrollSnap());
    
    carouselApi.on('select', () => {
      setCurrentSlide(carouselApi.selectedScrollSnap());
    });
  }, [carouselApi]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await supabase.functions.invoke('elite-daily-hitter-engine');
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRegenerate = async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('elite-daily-hitter-engine', {
        body: { force: true }
      });
      
      if (error) throw error;
      
      await refetch();
      setCurrentSlide(0);
      carouselApi?.scrollTo(0);
      toast({
        title: "Parlays Regenerated! 🔄",
        description: `${data?.parlays?.length || 0} new picks selected from latest data.`,
      });
    } catch (error) {
      toast({
        title: "Regeneration Failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Show paywall if user doesn't have access
  if (!isSubscriptionLoading && !hasEliteHitterAccess && !isAdmin) {
    return <EliteHitterPaywall />;
  }

  if (isLoading || isSubscriptionLoading) {
    return (
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!parlays || parlays.length === 0) {
    return (
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crown className="w-5 h-5 text-primary" />
            Daily Elite 3-Leg Hitter
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-6">
          <p className="text-muted-foreground mb-4">No elite parlays generated yet for today</p>
          <Button onClick={handleRefresh} disabled={isRefreshing} size="sm">
            {isRefreshing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Generate Now
          </Button>
        </CardContent>
      </Card>
    );
  }

  const displayDate = format(parseISO(parlays[0].parlay_date), 'MMM d');

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-background to-primary/10 overflow-hidden">
      {/* Header */}
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crown className="w-5 h-5 text-primary" />
            Daily Elite 3-Leg Hitter
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1">
              {parlays.length} picks
            </Badge>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  disabled={isRefreshing}
                  className="h-7 w-7 hover:bg-primary/10"
                  title="Regenerate with latest data"
                >
                  <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Regenerate Today's Parlays?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will replace all current picks with new selections based on the latest data from all engines.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRegenerate}>Regenerate</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Badge variant="outline" className="text-xs">{displayDate}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <Tabs defaultValue="today" className="w-full">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="today" className="flex-1 gap-1">
              <Target className="w-3 h-3" />
              Today
            </TabsTrigger>
            <TabsTrigger value="stats" className="flex-1 gap-1">
              <BarChart3 className="w-3 h-3" />
              Stats
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1 gap-1">
              <History className="w-3 h-3" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="mt-0">
            {parlays.length > 1 ? (
              <>
                <Carousel setApi={setCarouselApi} className="w-full">
                  <CarouselContent>
                    {parlays.map((parlay) => (
                      <CarouselItem key={parlay.id}>
                        <ParlayContent 
                          parlay={parlay} 
                          showRationale={showRationale}
                          setShowRationale={setShowRationale}
                        />
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                </Carousel>
                
                {/* Navigation Dots */}
                <div className="flex justify-center gap-1.5 mt-4">
                  {parlays.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => carouselApi?.scrollTo(index)}
                      className={cn(
                        "h-2 rounded-full transition-all duration-200",
                        currentSlide === index 
                          ? "w-6 bg-primary" 
                          : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                      )}
                      aria-label={`Go to pick ${index + 1}`}
                    />
                  ))}
                </div>
              </>
            ) : (
              <ParlayContent 
                parlay={parlays[0]} 
                showRationale={showRationale}
                setShowRationale={setShowRationale}
              />
            )}
          </TabsContent>

          <TabsContent value="stats" className="mt-0">
            <EliteHitterPerformance />
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <EliteHitterHistory />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
