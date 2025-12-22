import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Zap,
  Target,
  Activity,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Brain
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { LivePickCard } from './LivePickCard';
import { EnginePerformanceCard } from './EnginePerformanceCard';

const SPORTS = ['ALL', 'NBA', 'NFL', 'NHL', 'NCAAB', 'NCAAF', 'MLB', 'UFC'];
const ENGINES = [
  { id: 'all', label: 'All Engines', icon: Activity },
  { id: 'sharp', label: 'Sharp', icon: Zap },
  { id: 'godmode', label: 'God Mode', icon: Brain },
  { id: 'fatigue', label: 'Fatigue', icon: AlertCircle },
  { id: 'fanduel', label: 'FanDuel', icon: Target },
  { id: 'unified', label: 'Unified', icon: Activity },
];

interface TrackerPick {
  id: string;
  engine_name: string;
  sport: string;
  pick_description: string;
  player_name?: string;
  team_name?: string;
  prop_type?: string;
  line?: number;
  side?: string;
  odds?: number;
  confidence?: number;
  confidence_level?: string;
  signals?: any[];
  status: string;
  event_id?: string;
  game_time?: string;
  created_at: string;
}

interface EnginePerformance {
  total: number;
  won: number;
  lost: number;
  pending: number;
}

export function AllSportsTracker() {
  const [selectedSport, setSelectedSport] = useState('ALL');
  const [selectedEngine, setSelectedEngine] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch live picks from the tracker table
  const { data: picks, refetch, isLoading } = useQuery({
    queryKey: ['engine-live-tracker', selectedSport, selectedEngine],
    queryFn: async () => {
      let query = supabase
        .from('engine_live_tracker')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (selectedSport !== 'ALL') {
        query = query.eq('sport', selectedSport);
      }
      if (selectedEngine !== 'all') {
        const engineName = ENGINES.find(e => e.id === selectedEngine)?.label;
        if (engineName) {
          query = query.ilike('engine_name', `%${engineName.split(' ')[0]}%`);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as TrackerPick[];
    },
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  // Calculate performance stats
  const performance = (picks || []).reduce((acc, pick) => {
    if (!acc[pick.engine_name]) {
      acc[pick.engine_name] = { total: 0, won: 0, lost: 0, pending: 0 };
    }
    acc[pick.engine_name].total++;
    if (pick.status === 'won') acc[pick.engine_name].won++;
    else if (pick.status === 'lost') acc[pick.engine_name].lost++;
    else acc[pick.engine_name].pending++;
    return acc;
  }, {} as Record<string, EnginePerformance>);

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('engine-tracker-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'engine_live_tracker'
        },
        (payload) => {
          console.log('[Tracker] Realtime update:', payload);
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Trigger the unified feed to sync all engines
      const { error } = await supabase.functions.invoke('unified-live-feed', {
        body: { mode: 'aggregate', syncToTracker: true }
      });

      if (error) throw error;
      
      await refetch();
      toast.success('Tracker refreshed with latest picks');
    } catch (error) {
      console.error('Refresh error:', error);
      toast.error('Failed to refresh tracker');
    } finally {
      setIsRefreshing(false);
    }
  };

  const totalPicks = picks?.length || 0;
  const wonPicks = picks?.filter(p => p.status === 'won').length || 0;
  const lostPicks = picks?.filter(p => p.status === 'lost').length || 0;
  const pendingPicks = picks?.filter(p => p.status === 'pending').length || 0;
  const winRate = wonPicks + lostPicks > 0 
    ? ((wonPicks / (wonPicks + lostPicks)) * 100).toFixed(1) 
    : '0.0';

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            All-Sports Tracker
          </h1>
          <p className="text-muted-foreground text-sm">
            Real-time picks from all 8 engines
          </p>
        </div>
        <Button 
          onClick={handleRefresh} 
          disabled={isRefreshing}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Syncing...' : 'Refresh'}
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card/50">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold">{totalPicks}</div>
            <div className="text-xs text-muted-foreground">Total Picks</div>
          </CardContent>
        </Card>
        <Card className="bg-green-500/10 border-green-500/20">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-green-500">{wonPicks}</div>
            <div className="text-xs text-muted-foreground">Won</div>
          </CardContent>
        </Card>
        <Card className="bg-red-500/10 border-red-500/20">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-red-500">{lostPicks}</div>
            <div className="text-xs text-muted-foreground">Lost</div>
          </CardContent>
        </Card>
        <Card className="bg-primary/10 border-primary/20">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-primary">{winRate}%</div>
            <div className="text-xs text-muted-foreground">Win Rate</div>
          </CardContent>
        </Card>
      </div>

      {/* Sport Tabs */}
      <Tabs value={selectedSport} onValueChange={setSelectedSport}>
        <TabsList className="w-full overflow-x-auto flex-nowrap justify-start">
          {SPORTS.map(sport => (
            <TabsTrigger key={sport} value={sport} className="min-w-fit">
              {sport}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Engine Filter */}
      <div className="flex flex-wrap gap-2">
        {ENGINES.map(engine => {
          const Icon = engine.icon;
          const isActive = selectedEngine === engine.id;
          return (
            <Button
              key={engine.id}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedEngine(engine.id)}
              className="gap-1"
            >
              <Icon className="h-3 w-3" />
              {engine.label}
            </Button>
          );
        })}
      </div>

      {/* Engine Performance Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {Object.entries(performance).slice(0, 8).map(([engine, stats]) => (
          <EnginePerformanceCard 
            key={engine} 
            engine={engine} 
            stats={stats} 
          />
        ))}
      </div>

      {/* Live Picks Feed */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary animate-pulse" />
            Live Picks ({pendingPicks} pending)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading picks...
              </div>
            ) : picks?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No picks found for selected filters
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                <div className="space-y-2">
                  {picks?.map((pick, index) => (
                    <motion.div
                      key={pick.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ delay: index * 0.02 }}
                    >
                      <LivePickCard pick={pick} />
                    </motion.div>
                  ))}
                </div>
              </AnimatePresence>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
