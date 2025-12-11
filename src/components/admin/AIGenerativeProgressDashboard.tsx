import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Sparkles, 
  Play, 
  RefreshCw, 
  Loader2, 
  CheckCircle, 
  XCircle,
  Clock,
  TrendingUp,
  Target,
  Brain
} from 'lucide-react';
import { AIProgressGauge } from './AIProgressGauge';
import { AILearnedPatterns } from './AILearnedPatterns';

interface AIGeneratedParlay {
  id: string;
  created_at: string;
  generation_round: number;
  strategy_used: string;
  signals_used: string[];
  legs: Array<{ description: string; odds: number; signal_source?: string }>;
  total_odds: number;
  confidence_score: number;
  outcome: string;
  settled_at: string | null;
  ai_reasoning: string | null;
}

interface AILearningProgress {
  id: string;
  created_at: string;
  generation_round: number;
  parlays_generated: number;
  parlays_settled: number;
  wins: number;
  losses: number;
  current_accuracy: number;
  target_accuracy: number;
  strategy_weights: Record<string, number>;
  learned_patterns: { winning: string[]; losing: string[] };
  is_milestone: boolean;
  milestone_reached: string | null;
}

export function AIGenerativeProgressDashboard() {
  const { toast } = useToast();
  const [parlays, setParlays] = useState<AIGeneratedParlay[]>([]);
  const [progress, setProgress] = useState<AILearningProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'won' | 'lost'>('all');

  useEffect(() => {
    fetchData();
    
    // Subscribe to realtime updates
    const parlaysChannel = supabase
      .channel('ai-parlays-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ai_generated_parlays'
      }, () => fetchData())
      .subscribe();

    const progressChannel = supabase
      .channel('ai-progress-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ai_learning_progress'
      }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(parlaysChannel);
      supabase.removeChannel(progressChannel);
    };
  }, []);

  const fetchData = async () => {
    try {
      // Fetch parlays
      const { data: parlaysData, error: parlaysError } = await supabase
        .from('ai_generated_parlays')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (parlaysError) throw parlaysError;
      
      const typedParlays = (parlaysData || []).map(p => ({
        ...p,
        legs: p.legs as unknown as Array<{ description: string; odds: number; signal_source?: string }>
      })) as AIGeneratedParlay[];
      
      setParlays(typedParlays);

      // Fetch latest progress
      const { data: progressData, error: progressError } = await supabase
        .from('ai_learning_progress')
        .select('*')
        .order('generation_round', { ascending: false })
        .limit(1)
        .single();

      if (!progressError && progressData) {
        setProgress(progressData as AILearningProgress);
      }
    } catch (err) {
      console.error('Error fetching AI data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-continuous-parlay-generator');
      
      if (error) throw error;

      toast({
        title: 'Parlays Generated',
        description: `Round ${data.round}: Generated ${data.parlaysGenerated} parlays`
      });

      fetchData();
    } catch (err) {
      console.error('Generation error:', err);
      toast({
        title: 'Generation Failed',
        description: 'Could not generate parlays',
        variant: 'destructive'
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSettle = async () => {
    setIsSettling(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-settle-parlays');
      
      if (error) throw error;

      toast({
        title: 'Settlement Complete',
        description: `Processed ${data.processed || 0} parlays`
      });

      fetchData();
    } catch (err) {
      console.error('Settlement error:', err);
      toast({
        title: 'Settlement Failed',
        description: 'Could not settle parlays',
        variant: 'destructive'
      });
    } finally {
      setIsSettling(false);
    }
  };

  const filteredParlays = parlays.filter(p => {
    if (filter === 'all') return true;
    return p.outcome === filter;
  });

  const stats = {
    total: parlays.length,
    pending: parlays.filter(p => p.outcome === 'pending').length,
    won: parlays.filter(p => p.outcome === 'won').length,
    lost: parlays.filter(p => p.outcome === 'lost').length
  };

  const winRate = stats.won + stats.lost > 0 
    ? ((stats.won / (stats.won + stats.lost)) * 100).toFixed(1)
    : '0.0';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Progress Gauge */}
      <Card className="bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border-cyan-500/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-cyan-500/20">
                <Sparkles className="w-6 h-6 text-cyan-500" />
              </div>
              <div>
                <CardTitle className="text-xl">AI Parlay Generator</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Self-learning system targeting 65% accuracy
                </p>
              </div>
            </div>
            <Badge variant={progress?.is_milestone ? 'default' : 'secondary'}>
              Round #{progress?.generation_round || 0}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <AIProgressGauge 
              currentAccuracy={progress?.current_accuracy || 0}
              targetAccuracy={progress?.target_accuracy || 65}
              winRate={parseFloat(winRate)}
            />
            
            <div className="space-y-4">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{stats.total}</p>
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

              {/* Control Buttons */}
              <div className="flex gap-2">
                <Button 
                  onClick={handleGenerate} 
                  disabled={isGenerating}
                  className="flex-1 bg-cyan-600 hover:bg-cyan-700"
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Generate
                </Button>
                <Button 
                  onClick={handleSettle} 
                  disabled={isSettling}
                  variant="outline"
                  className="flex-1"
                >
                  {isSettling ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Settle
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Learned Patterns */}
      <AILearnedPatterns 
        patterns={progress?.learned_patterns || { winning: [], losing: [] }}
        weights={progress?.strategy_weights || {}}
      />

      {/* Generation Log */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              Generation Log
            </CardTitle>
            <div className="flex gap-1">
              {(['all', 'pending', 'won', 'lost'] as const).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className="text-xs h-7 px-2"
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  {f !== 'all' && (
                    <span className="ml-1 text-muted-foreground">
                      ({f === 'pending' ? stats.pending : f === 'won' ? stats.won : stats.lost})
                    </span>
                  )}
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
                  <p>No parlays generated yet</p>
                  <p className="text-sm">Click "Generate" to start</p>
                </div>
              ) : (
                filteredParlays.map((parlay) => (
                  <Card key={parlay.id} className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            #{parlay.generation_round}
                          </Badge>
                          <Badge 
                            variant={
                              parlay.outcome === 'won' ? 'default' :
                              parlay.outcome === 'lost' ? 'destructive' :
                              'secondary'
                            }
                            className="text-xs"
                          >
                            {parlay.outcome === 'won' && <CheckCircle className="w-3 h-3 mr-1" />}
                            {parlay.outcome === 'lost' && <XCircle className="w-3 h-3 mr-1" />}
                            {parlay.outcome === 'pending' && <Clock className="w-3 h-3 mr-1" />}
                            {parlay.outcome.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono font-bold">
                            {parlay.total_odds > 0 ? `+${parlay.total_odds.toFixed(0)}` : parlay.total_odds.toFixed(0)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {parlay.confidence_score.toFixed(0)}% conf
                          </p>
                        </div>
                      </div>

                      <p className="text-xs text-cyan-500 font-medium mb-2">
                        {parlay.strategy_used}
                      </p>

                      <div className="space-y-1">
                        {parlay.legs.map((leg, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs">
                              {idx + 1}
                            </div>
                            <span className="flex-1 truncate">{leg.description}</span>
                            <Badge variant="outline" className="text-xs font-mono">
                              {leg.odds > 0 ? `+${leg.odds}` : leg.odds}
                            </Badge>
                          </div>
                        ))}
                      </div>

                      {parlay.ai_reasoning && (
                        <p className="text-xs text-muted-foreground mt-2 italic">
                          {parlay.ai_reasoning}
                        </p>
                      )}

                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(parlay.created_at).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
