import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Zap, 
  RefreshCw, 
  TrendingUp, 
  Target, 
  AlertTriangle,
  Activity,
  Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { GodModeUpsetCard } from './GodModeUpsetCard';
import { ChaosModeIndicator } from './ChaosModeIndicator';
import { UpsetScoreGauge } from './UpsetScoreGauge';
import type { GodModeUpsetPrediction, GodModeAccuracyMetrics } from '@/types/god-mode';

export function GodModeDashboard() {
  const [predictions, setPredictions] = useState<GodModeUpsetPrediction[]>([]);
  const [accuracy, setAccuracy] = useState<GodModeAccuracyMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSport, setSelectedSport] = useState('all');
  const { toast } = useToast();

  // Fetch predictions
  const fetchPredictions = async () => {
    try {
      const { data, error } = await supabase
        .from('god_mode_upset_predictions')
        .select('*')
        .eq('game_completed', false)
        .gte('commence_time', new Date().toISOString())
        .order('final_upset_score', { ascending: false });

      if (error) throw error;
      
      // Transform database rows to match our interface
      const transformed = (data || []).map(row => ({
        ...row,
        confidence: row.confidence as 'high' | 'medium' | 'low',
        risk_level: row.risk_level as 1 | 2 | 3 | 4 | 5,
        suggestion: row.suggestion as 'play' | 'avoid' | 'parlay_add' | 'upset_alert',
        odds_change_direction: (row.odds_change_direction || 'stable') as 'up' | 'down' | 'stable',
        signals: Array.isArray(row.signals) ? row.signals as any : [],
        reasons: Array.isArray(row.reasons) ? row.reasons as string[] : [],
        parlay_impact: (typeof row.parlay_impact === 'object' && row.parlay_impact !== null ? row.parlay_impact : { evImpact: 0, riskReduction: 0, synergyBoost: 0 }) as any
      }));
      
      setPredictions(transformed as GodModeUpsetPrediction[]);
    } catch (error) {
      console.error('Error fetching predictions:', error);
    }
  };

  // Fetch accuracy metrics
  const fetchAccuracy = async () => {
    try {
      const { data, error } = await supabase
        .from('god_mode_accuracy_metrics')
        .select('*')
        .order('accuracy_rate', { ascending: false });

      if (error) throw error;
      setAccuracy((data || []) as GodModeAccuracyMetrics[]);
    } catch (error) {
      console.error('Error fetching accuracy:', error);
    }
  };

  // Run the God Mode engine
  const runEngine = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('god-mode-upset-engine', {
        body: { sport: selectedSport === 'all' ? null : selectedSport }
      });

      if (error) throw error;

      toast({
        title: '🔮 God Mode Updated',
        description: `Analyzed ${data.totalEvents} events. ${data.chaosCount} chaos games detected.`
      });

      await fetchPredictions();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setRefreshing(false);
    }
  };

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchPredictions(), fetchAccuracy()]);
      setLoading(false);
    };
    load();
  }, []);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('god-mode-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'god_mode_upset_predictions'
        },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            setPredictions(prev => {
              const newPred = payload.new as GodModeUpsetPrediction;
              const existing = prev.findIndex(p => p.id === newPred.id);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = {
                  ...newPred,
                  signals: Array.isArray(newPred.signals) ? newPred.signals : [],
                  reasons: Array.isArray(newPred.reasons) ? newPred.reasons : [],
                  parlay_impact: typeof newPred.parlay_impact === 'object' ? newPred.parlay_impact : { evImpact: 0, riskReduction: 0, synergyBoost: 0 }
                };
                return updated;
              }
              return [...prev, {
                ...newPred,
                signals: Array.isArray(newPred.signals) ? newPred.signals : [],
                reasons: Array.isArray(newPred.reasons) ? newPred.reasons : [],
                parlay_impact: typeof newPred.parlay_impact === 'object' ? newPred.parlay_impact : { evImpact: 0, riskReduction: 0, synergyBoost: 0 }
              }];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Filter predictions by sport
  const filteredPredictions = selectedSport === 'all' 
    ? predictions 
    : predictions.filter(p => p.sport === selectedSport);

  // Stats
  const highConfidence = filteredPredictions.filter(p => p.confidence === 'high');
  const chaosGames = filteredPredictions.filter(p => p.chaos_mode_active);
  const globalChaos = chaosGames.length >= 3;
  const avgChaos = chaosGames.length > 0 
    ? chaosGames.reduce((sum, p) => sum + p.chaos_percentage, 0) / chaosGames.length 
    : 0;

  // Get unique sports
  const sports = [...new Set(predictions.map(p => p.sport))];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-chart-1" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Chaos Mode Banner */}
      <ChaosModeIndicator
        chaosPercentage={avgChaos}
        isActive={globalChaos}
        variant="banner"
      />

      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-chart-2/10 to-chart-2/5">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">High Confidence</p>
                <p className="text-2xl font-bold text-chart-2">{highConfidence.length}</p>
              </div>
              <Target className="h-8 w-8 text-chart-2/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/5">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Chaos Games</p>
                <p className="text-2xl font-bold text-purple-500">{chaosGames.length}</p>
              </div>
              <Zap className="h-8 w-8 text-purple-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-chart-4/10 to-chart-4/5">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Trap Alerts</p>
                <p className="text-2xl font-bold text-chart-4">
                  {filteredPredictions.filter(p => p.trap_on_favorite).length}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-chart-4/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-chart-1/10 to-chart-1/5">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Live Tracking</p>
                <p className="text-2xl font-bold text-chart-1">
                  {filteredPredictions.filter(p => p.is_live).length}
                </p>
              </div>
              <Activity className="h-8 w-8 text-chart-1/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <Tabs value={selectedSport} onValueChange={setSelectedSport}>
          <TabsList>
            <TabsTrigger value="all">All Sports</TabsTrigger>
            {sports.map(sport => (
              <TabsTrigger key={sport} value={sport}>
                {sport.replace('basketball_', '').replace('americanfootball_', '').toUpperCase()}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button 
          onClick={runEngine} 
          disabled={refreshing}
          className="gap-2"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh Analysis
        </Button>
      </div>

      {/* Predictions Grid */}
      {filteredPredictions.length === 0 ? (
        <Card className="p-8 text-center">
          <Zap className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No Active Predictions</h3>
          <p className="text-muted-foreground mb-4">
            Click "Refresh Analysis" to scan for upset opportunities
          </p>
          <Button onClick={runEngine} disabled={refreshing}>
            Run God Mode Engine
          </Button>
        </Card>
      ) : (
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filteredPredictions.map((prediction, index) => (
              <motion.div
                key={prediction.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: index * 0.05 }}
              >
                <GodModeUpsetCard prediction={prediction} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Accuracy Stats */}
      {accuracy.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-chart-2" />
              Historical Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {accuracy.slice(0, 3).map((metric) => (
                <div 
                  key={metric.id}
                  className="rounded-lg bg-muted/50 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant={metric.chaos_mode_active ? 'default' : 'outline'}>
                      {metric.confidence_level.toUpperCase()}
                      {metric.chaos_mode_active && ' + CHAOS'}
                    </Badge>
                    <UpsetScoreGauge score={metric.accuracy_rate} size="sm" showLabel={false} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Sample:</span>
                      <span className="ml-1 font-semibold">{metric.total_predictions}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">ROI:</span>
                      <span className={`ml-1 font-semibold ${metric.roi_percentage >= 0 ? 'text-chart-2' : 'text-destructive'}`}>
                        {metric.roi_percentage >= 0 ? '+' : ''}{metric.roi_percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
