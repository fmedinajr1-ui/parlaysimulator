import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { 
  Ban, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  Target, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface AvoidPattern {
  id: string;
  pattern_type: string;
  pattern_key: string;
  description: string;
  sport: string;
  engine_source: string;
  formula_name: string;
  loss_count: number;
  accuracy_rate: number;
  is_active: boolean;
  avoid_reason: string;
}

interface CompoundFormula {
  id: string;
  combination: string;
  wins: number;
  losses: number;
  total_picks: number;
  accuracy_rate: number;
  is_preferred: boolean;
  sports: string[];
}

interface CrossEnginePerf {
  id: string;
  engine_a: string;
  engine_b: string;
  sport: string;
  both_wins: number;
  both_losses: number;
  total_comparisons: number;
  preference_score: number;
}

interface FormulaWithPatterns {
  id: string;
  formula_name: string;
  engine_source: string;
  current_accuracy: number | null;
  current_weight: number | null;
  total_picks: number | null;
  wins: number | null;
  losses: number | null;
  loss_patterns: unknown;
}

export function AILearningInsights() {
  const [avoidPatterns, setAvoidPatterns] = useState<AvoidPattern[]>([]);
  const [compoundFormulas, setCompoundFormulas] = useState<CompoundFormula[]>([]);
  const [crossEngine, setCrossEngine] = useState<CrossEnginePerf[]>([]);
  const [formulas, setFormulas] = useState<FormulaWithPatterns[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [avoidRes, compoundRes, crossRes, formulaRes] = await Promise.all([
        supabase.from('ai_avoid_patterns').select('*').order('loss_count', { ascending: false }),
        supabase.from('ai_compound_formulas').select('*').order('accuracy_rate', { ascending: false }),
        supabase.from('ai_cross_engine_performance').select('*').order('preference_score', { ascending: false }),
        supabase.from('ai_formula_performance').select('*').order('current_accuracy', { ascending: false })
      ]);

      setAvoidPatterns((avoidRes.data || []) as AvoidPattern[]);
      setCompoundFormulas((compoundRes.data || []) as CompoundFormula[]);
      setCrossEngine((crossRes.data || []) as CrossEnginePerf[]);
      setFormulas((formulaRes.data || []) as FormulaWithPatterns[]);
    } catch (error) {
      console.error('Error fetching learning insights:', error);
    }
    setIsLoading(false);
  };

  const runFullLearningCycle = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-learning-engine', {
        body: { action: 'full_learning_cycle' }
      });

      if (error) throw error;

      toast.success('Learning cycle complete!', {
        description: `Weights: ${data.weights_updated?.weights_updated || 0}, Combos: ${data.compound_formulas?.combinations_updated || 0}, Patterns: ${data.avoid_patterns?.patterns_updated || 0}`
      });
      
      fetchData();
    } catch (error) {
      toast.error('Learning cycle failed');
      console.error(error);
    }
    setIsRunning(false);
  };

  const activeAvoidPatterns = avoidPatterns.filter(p => p.is_active);
  const preferredCombos = compoundFormulas.filter(c => c.is_preferred);
  const topCrossEngine = crossEngine.filter(c => c.total_comparisons >= 3);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Action Button */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">AI Learning Insights</h3>
        <Button 
          onClick={runFullLearningCycle} 
          disabled={isRunning}
          size="sm"
          variant="outline"
        >
          {isRunning ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Run Learning Cycle
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Ban className="w-4 h-4 text-red-500" />
              <span className="text-sm font-medium">Avoid Patterns</span>
            </div>
            <p className="text-2xl font-bold text-red-500 mt-1">{activeAvoidPatterns.length}</p>
            <p className="text-xs text-muted-foreground">Active blocks</p>
          </CardContent>
        </Card>

        <Card className="bg-green-500/10 border-green-500/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium">Preferred Combos</span>
            </div>
            <p className="text-2xl font-bold text-green-500 mt-1">{preferredCombos.length}</p>
            <p className="text-xs text-muted-foreground">55%+ accuracy</p>
          </CardContent>
        </Card>

        <Card className="bg-cyan-500/10 border-cyan-500/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-cyan-500" />
              <span className="text-sm font-medium">Cross-Engine</span>
            </div>
            <p className="text-2xl font-bold text-cyan-500 mt-1">{topCrossEngine.length}</p>
            <p className="text-xs text-muted-foreground">Engine pairs tracked</p>
          </CardContent>
        </Card>

        <Card className="bg-purple-500/10 border-purple-500/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-500" />
              <span className="text-sm font-medium">Active Formulas</span>
            </div>
            <p className="text-2xl font-bold text-purple-500 mt-1">{formulas.length}</p>
            <p className="text-xs text-muted-foreground">Being tracked</p>
          </CardContent>
        </Card>
      </div>

      {/* Avoid Patterns */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Patterns Being Avoided
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeAvoidPatterns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No patterns currently being avoided</p>
          ) : (
            <ScrollArea className="h-[150px]">
              <div className="space-y-2">
                {activeAvoidPatterns.map((pattern) => (
                  <div key={pattern.id} className="flex items-center justify-between p-2 rounded-lg bg-red-500/5 border border-red-500/20">
                    <div>
                      <p className="text-sm font-medium">{pattern.formula_name}</p>
                      <p className="text-xs text-muted-foreground">{pattern.sport} • {pattern.avoid_reason}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="destructive" className="text-xs">
                        {pattern.loss_count} losses
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">{pattern.accuracy_rate.toFixed(0)}% acc</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Preferred Compound Formulas */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Preferred Formula Combinations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {preferredCombos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No preferred combinations yet (need 5+ picks at 55%+ accuracy)</p>
          ) : (
            <ScrollArea className="h-[150px]">
              <div className="space-y-2">
                {preferredCombos.slice(0, 10).map((combo) => (
                  <div key={combo.id} className="flex items-center justify-between p-2 rounded-lg bg-green-500/5 border border-green-500/20">
                    <div>
                      <p className="text-sm font-medium">{combo.combination.split('+').join(' + ')}</p>
                      <p className="text-xs text-muted-foreground">{combo.sports?.join(', ') || 'Mixed'}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="default" className="text-xs bg-green-600">
                        {combo.accuracy_rate.toFixed(0)}%
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">{combo.wins}W-{combo.losses}L</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Cross-Engine Performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-500" />
            Best Engine Combinations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topCrossEngine.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not enough data for cross-engine analysis</p>
          ) : (
            <ScrollArea className="h-[150px]">
              <div className="space-y-2">
                {topCrossEngine.slice(0, 8).map((ce) => (
                  <div key={ce.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                    <div>
                      <p className="text-sm font-medium">{ce.engine_a} + {ce.engine_b}</p>
                      <p className="text-xs text-muted-foreground">{ce.sport}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Progress value={ce.preference_score} className="w-16 h-2" />
                      <span className="text-sm font-mono">{ce.preference_score.toFixed(0)}%</span>
                      <span className="text-xs text-muted-foreground">({ce.both_wins}W-{ce.both_losses}L)</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Recent Loss Patterns */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-400" />
            Recent Loss Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[150px]">
            <div className="space-y-2">
              {formulas
                .filter(f => f.loss_patterns && (f.loss_patterns as any[]).length > 0)
                .slice(0, 5)
                .map((formula) => {
                  const patterns = (formula.loss_patterns as any[]) || [];
                  const recentLoss = patterns[patterns.length - 1];
                  return (
                    <div key={formula.id} className="p-2 rounded-lg bg-muted/30">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{formula.formula_name}</p>
                        <Badge variant={formula.current_accuracy >= 50 ? 'outline' : 'destructive'}>
                          {formula.current_accuracy.toFixed(0)}%
                        </Badge>
                      </div>
                      {recentLoss && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          <p>Last loss: {recentLoss.description?.substring(0, 50)}...</p>
                          {recentLoss.miss_amount && (
                            <p>Missed by: {recentLoss.miss_amount.toFixed(1)}</p>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {patterns.length} losses tracked • Weight: {formula.current_weight}x
                      </p>
                    </div>
                  );
                })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}