import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Brain, 
  Zap, 
  TrendingUp, 
  Target, 
  RefreshCw, 
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  BarChart3,
  Layers,
  Activity,
  Sparkles
} from 'lucide-react';
import { AIProgressGauge } from './AIProgressGauge';
import { AILearnedPatterns } from './AILearnedPatterns';
import { Json } from '@/integrations/supabase/types';

interface AIGeneratedParlay {
  id: string;
  generation_round: number;
  strategy_used: string;
  signals_used: string[];
  legs: Json;
  total_odds: number;
  confidence_score: number;
  outcome: string;
  created_at: string;
  settled_at: string | null;
  ai_reasoning: string | null;
  accuracy_at_generation: number | null;
  formula_breakdown: Json;
  source_engines: string[];
  leg_sources: Json;
  sport: string | null;
}

interface AILearningProgress {
  id: string;
  generation_round: number;
  parlays_generated: number;
  parlays_settled: number;
  wins: number;
  losses: number;
  current_accuracy: number;
  target_accuracy: number;
  strategy_weights: Json;
  learned_patterns: Json;
  is_milestone: boolean;
  milestone_reached: string | null;
  created_at: string;
}

interface FormulaPerformance {
  id: string;
  formula_name: string;
  engine_source: string;
  total_picks: number;
  wins: number;
  losses: number;
  current_accuracy: number;
  current_weight: number;
  last_win_streak: number;
  last_loss_streak: number;
  sport_breakdown: Json;
  compound_formulas: Json;
}

export function AIGenerativeProgressDashboard() {
  const [parlays, setParlays] = useState<AIGeneratedParlay[]>([]);
  const [learningProgress, setLearningProgress] = useState<AILearningProgress | null>(null);
  const [formulaPerformance, setFormulaPerformance] = useState<FormulaPerformance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLearning, setIsLearning] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'won' | 'lost'>('all');

  useEffect(() => {
    fetchData();
    
    const parlayChannel = supabase
      .channel('ai_parlays_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_generated_parlays' }, fetchData)
      .subscribe();

    const progressChannel = supabase
      .channel('ai_progress_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_learning_progress' }, fetchData)
      .subscribe();

    const formulaChannel = supabase
      .channel('formula_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_formula_performance' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(parlayChannel);
      supabase.removeChannel(progressChannel);
      supabase.removeChannel(formulaChannel);
    };
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    
    const [parlayRes, progressRes, formulaRes] = await Promise.all([
      supabase
        .from('ai_generated_parlays')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('ai_learning_progress')
        .select('*')
        .order('generation_round', { ascending: false })
        .limit(1),
      supabase
        .from('ai_formula_performance')
        .select('*')
        .order('current_accuracy', { ascending: false })
    ]);

    if (parlayRes.data) setParlays(parlayRes.data as AIGeneratedParlay[]);
    if (progressRes.data && progressRes.data.length > 0) setLearningProgress(progressRes.data[0] as AILearningProgress);
    if (formulaRes.data) setFormulaPerformance(formulaRes.data as FormulaPerformance[]);
    
    setIsLoading(false);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-continuous-parlay-generator');
      if (error) throw error;
      toast.success(`Generated ${data?.parlays_generated || 0} parlays across all sports!`);
      fetchData();
    } catch (error) {
      toast.error('Generation failed: ' + (error as Error).message);
    }
    setIsGenerating(false);
  };

  const handleRunLearningCycle = async () => {
    setIsLearning(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-learning-engine', {
        body: { action: 'full_learning_cycle' }
      });
      if (error) throw error;
      toast.success(`Learning cycle complete! ${data?.weights_updated?.weights_updated || 0} weights updated.`);
      fetchData();
    } catch (error) {
      toast.error('Learning cycle failed: ' + (error as Error).message);
    }
    setIsLearning(false);
  };

  const filteredParlays = parlays.filter(p => {
    if (filter === 'all') return true;
    return p.outcome === filter;
  });

  const stats = {
    total: parlays.length,
    pending: parlays.filter(p => p.outcome === 'pending').length,
    won: parlays.filter(p => p.outcome === 'won').length,
    lost: parlays.filter(p => p.outcome === 'lost').length,
  };

  const winRate = stats.won + stats.lost > 0 
    ? ((stats.won / (stats.won + stats.lost)) * 100).toFixed(1)
    : '0.0';

  // Calculate sport distribution
  const sportDistribution: Record<string, number> = {};
  parlays.forEach(p => {
    const sport = p.sport || 'unknown';
    sportDistribution[sport] = (sportDistribution[sport] || 0) + 1;
  });

  // Calculate engine contribution
  const engineContribution: Record<string, { total: number; wins: number }> = {};
  parlays.forEach(p => {
    (p.source_engines || []).forEach(engine => {
      if (!engineContribution[engine]) {
        engineContribution[engine] = { total: 0, wins: 0 };
      }
      engineContribution[engine].total++;
      if (p.outcome === 'won') {
        engineContribution[engine].wins++;
      }
    });
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Progress */}
      <Card className="bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border-cyan-500/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-cyan-500/20">
                <Brain className="w-6 h-6 text-cyan-500" />
              </div>
              <div>
                <CardTitle className="text-xl">AI Parlay Training System</CardTitle>
                <p className="text-sm text-muted-foreground">
                  50+ daily parlays • Auto-learning • Formula optimization
                </p>
              </div>
            </div>
            <Badge variant={learningProgress?.is_milestone ? 'default' : 'secondary'}>
              Round #{learningProgress?.generation_round || 0}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <AIProgressGauge 
              currentAccuracy={learningProgress?.current_accuracy || 0}
              targetAccuracy={learningProgress?.target_accuracy || 65}
              winRate={parseFloat(winRate)}
            />
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Generated</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-cyan-500">{winRate}%</p>
                  <p className="text-xs text-muted-foreground">Win Rate</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-500">{stats.won}</p>
                  <p className="text-xs text-muted-foreground">Wins</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-500">{stats.lost}</p>
                  <p className="text-xs text-muted-foreground">Losses</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleGenerate} disabled={isGenerating} className="flex-1 bg-cyan-600 hover:bg-cyan-700">
                  {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                  Generate 50+ Parlays
                </Button>
                <Button onClick={handleRunLearningCycle} disabled={isLearning} variant="outline" className="flex-1">
                  {isLearning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Learn
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <BarChart3 className="w-8 h-8 text-primary/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-yellow-500">{stats.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Won</p>
                <p className="text-2xl font-bold text-green-500">{stats.won}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Lost</p>
                <p className="text-2xl font-bold text-red-500">{stats.lost}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Accuracy</p>
                <p className="text-2xl font-bold">{learningProgress?.current_accuracy?.toFixed(1) || 0}%</p>
              </div>
              <Target className="w-8 h-8 text-primary/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="formulas" className="space-y-4">
        <TabsList>
          <TabsTrigger value="formulas" className="gap-2">
            <Activity className="w-4 h-4" />
            Formula Performance
          </TabsTrigger>
          <TabsTrigger value="engines" className="gap-2">
            <Layers className="w-4 h-4" />
            Engine Stats
          </TabsTrigger>
          <TabsTrigger value="parlays" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Parlays
          </TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
        </TabsList>

        <TabsContent value="formulas">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Formula Performance Tracker ({formulaPerformance.length} formulas)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {formulaPerformance.map((formula) => (
                    <div key={formula.id} className="p-4 bg-muted/30 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {formula.engine_source.toUpperCase()}
                          </Badge>
                          <span className="font-medium">{formula.formula_name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            Weight: <span className={formula.current_weight > 1 ? 'text-green-500' : formula.current_weight < 1 ? 'text-red-500' : ''}>
                              {formula.current_weight.toFixed(2)}x
                            </span>
                          </span>
                          <span className={`font-bold ${formula.current_accuracy >= 55 ? 'text-green-500' : formula.current_accuracy >= 45 ? 'text-yellow-500' : 'text-red-500'}`}>
                            {formula.current_accuracy.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">{formula.total_picks} picks</span>
                        <span className="text-green-500">{formula.wins}W</span>
                        <span className="text-red-500">{formula.losses}L</span>
                        {formula.last_win_streak >= 3 && (
                          <Badge className="bg-green-500/20 text-green-500">🔥 {formula.last_win_streak} streak</Badge>
                        )}
                        {formula.last_loss_streak >= 3 && (
                          <Badge className="bg-red-500/20 text-red-500">❄️ {formula.last_loss_streak} cold</Badge>
                        )}
                      </div>
                      <Progress value={formula.current_accuracy} className="h-2 mt-2" />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="engines">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Engine Contribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(engineContribution)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([engine, data]) => {
                      const winRate = data.total > 0 ? (data.wins / data.total) * 100 : 0;
                      return (
                        <div key={engine} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium capitalize">{engine}</span>
                            <span className="text-muted-foreground">
                              {data.total} parlays • {data.wins}W • {winRate.toFixed(1)}%
                            </span>
                          </div>
                          <Progress value={winRate} className="h-2" />
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sport Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(sportDistribution)
                    .sort((a, b) => b[1] - a[1])
                    .map(([sport, count]) => {
                      const percentage = parlays.length > 0 ? (count / parlays.length) * 100 : 0;
                      return (
                        <div key={sport} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium">{sport.replace(/_/g, ' ').toUpperCase()}</span>
                            <span className="text-muted-foreground">{count} parlays</span>
                          </div>
                          <Progress value={percentage} className="h-2" />
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="parlays">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  Generated Parlays
                </CardTitle>
                <div className="flex gap-1">
                  {(['all', 'pending', 'won', 'lost'] as const).map(f => (
                    <Button
                      key={f}
                      variant={filter === f ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setFilter(f)}
                      className="text-xs h-7"
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {filteredParlays.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Sparkles className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No parlays yet. Click "Generate 50+ Parlays" to start!</p>
                    </div>
                  ) : (
                    filteredParlays.slice(0, 50).map((parlay) => {
                      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
                      return (
                        <Card key={parlay.id} className="bg-muted/30">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Badge variant={
                                  parlay.outcome === 'won' ? 'default' :
                                  parlay.outcome === 'lost' ? 'destructive' : 'secondary'
                                }>
                                  {parlay.outcome === 'won' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                  {parlay.outcome === 'lost' && <XCircle className="w-3 h-3 mr-1" />}
                                  {parlay.outcome === 'pending' && <Clock className="w-3 h-3 mr-1" />}
                                  {parlay.outcome.toUpperCase()}
                                </Badge>
                                <span className="text-xs text-muted-foreground">#{parlay.generation_round}</span>
                                {parlay.sport && (
                                  <Badge variant="outline" className="text-xs">
                                    {parlay.sport.replace(/_/g, ' ')}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-right">
                                <span className="font-mono font-bold">
                                  {parlay.total_odds > 0 ? '+' : ''}{parlay.total_odds}
                                </span>
                                <p className="text-xs text-muted-foreground">{parlay.confidence_score.toFixed(0)}% conf</p>
                              </div>
                            </div>
                            
                            <p className="text-xs text-cyan-500 font-medium mb-2">{parlay.strategy_used}</p>

                            <div className="space-y-1">
                              {legs.slice(0, 3).map((leg: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 text-sm">
                                  <Badge variant="outline" className="text-xs">{leg.engine_source || '?'}</Badge>
                                  <span className="truncate flex-1">{leg.description}</span>
                                  <span className="font-mono text-xs">{leg.odds > 0 ? '+' : ''}{leg.odds}</span>
                                </div>
                              ))}
                              {legs.length > 3 && (
                                <p className="text-xs text-muted-foreground">+{legs.length - 3} more legs</p>
                              )}
                            </div>

                            {parlay.source_engines && parlay.source_engines.length > 0 && (
                              <div className="flex gap-1 flex-wrap mt-2">
                                {parlay.source_engines.map((engine, idx) => (
                                  <Badge key={idx} variant="secondary" className="text-xs">{engine}</Badge>
                                ))}
                              </div>
                            )}

                            <p className="text-xs text-muted-foreground mt-2">
                              {new Date(parlay.created_at).toLocaleString()}
                            </p>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="patterns">
          {learningProgress && (
            <AILearnedPatterns
              patterns={(learningProgress.learned_patterns as { winning: string[]; losing: string[] }) || { winning: [], losing: [] }}
              weights={(learningProgress.strategy_weights as Record<string, number>) || {}}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AIGenerativeProgressDashboard;
