import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Slider } from '@/components/ui/slider';
import { RefreshCw, Save, Settings, Zap } from 'lucide-react';

interface Weight {
  id: string;
  sport: string;
  weight_key: string;
  weight_value: number;
  description: string | null;
  is_active: boolean;
}

const WEIGHT_LABELS: Record<string, string> = {
  sharp_pct: 'Sharp Money %',
  chess_ev: 'CHESS EV',
  upset_value: 'Upset Value',
  record_diff: 'Record Differential',
  home_court: 'Home Court',
  historical_day: 'Historical Day',
  monte_carlo: 'Monte Carlo',
};

export function GodModeWeightsPanel() {
  const [weights, setWeights] = useState<Weight[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editedWeights, setEditedWeights] = useState<Record<string, number>>({});
  const { toast } = useToast();

  const fetchWeights = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('god_mode_weights')
        .select('*')
        .order('sport')
        .order('weight_key');

      if (error) throw error;
      setWeights(data || []);
      
      // Initialize edited weights
      const initial: Record<string, number> = {};
      for (const w of data || []) {
        initial[w.id] = w.weight_value;
      }
      setEditedWeights(initial);
    } catch (err) {
      console.error('Error fetching weights:', err);
      toast({
        title: 'Error',
        description: 'Failed to load weights',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWeights();
  }, []);

  const handleWeightChange = (id: string, value: number) => {
    setEditedWeights(prev => ({ ...prev, [id]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates = Object.entries(editedWeights).map(([id, weight_value]) => ({
        id,
        weight_value,
        updated_at: new Date().toISOString(),
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('god_mode_weights')
          .update({ weight_value: update.weight_value, updated_at: update.updated_at })
          .eq('id', update.id);

        if (error) throw error;
      }

      toast({
        title: 'Weights Saved',
        description: `Updated ${updates.length} weight configurations`,
      });

      fetchWeights();
    } catch (err) {
      console.error('Error saving weights:', err);
      toast({
        title: 'Error',
        description: 'Failed to save weights',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleNormalize = (sport: string) => {
    const sportWeights = weights.filter(w => w.sport === sport);
    const total = sportWeights.reduce((sum, w) => sum + (editedWeights[w.id] || w.weight_value), 0);
    
    if (total === 0) return;

    const normalized: Record<string, number> = {};
    for (const w of sportWeights) {
      normalized[w.id] = Math.round((editedWeights[w.id] || w.weight_value) / total * 100) / 100;
    }

    setEditedWeights(prev => ({ ...prev, ...normalized }));
    
    toast({
      title: 'Weights Normalized',
      description: `${sport} weights now sum to 1.0`,
    });
  };

  const groupedWeights = weights.reduce((acc, w) => {
    if (!acc[w.sport]) acc[w.sport] = [];
    acc[w.sport].push(w);
    return acc;
  }, {} as Record<string, Weight[]>);

  const getSportColor = (sport: string) => {
    const colors: Record<string, string> = {
      NBA: 'bg-orange-500/20 text-orange-400',
      NFL: 'bg-green-500/20 text-green-400',
      NHL: 'bg-blue-500/20 text-blue-400',
      MLB: 'bg-red-500/20 text-red-400',
      DEFAULT: 'bg-purple-500/20 text-purple-400',
    };
    return colors[sport] || colors.DEFAULT;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg">God Mode Weight Configuration</CardTitle>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchWeights} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            <Save className="w-4 h-4 mr-1" />
            {isSaving ? 'Saving...' : 'Save All'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading weights...</div>
        ) : (
          Object.entries(groupedWeights).map(([sport, sportWeights]) => {
            const total = sportWeights.reduce((sum, w) => sum + (editedWeights[w.id] || w.weight_value), 0);
            
            return (
              <div key={sport} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={getSportColor(sport)}>{sport}</Badge>
                    <span className="text-sm text-muted-foreground">
                      Total: {total.toFixed(2)}
                    </span>
                    {Math.abs(total - 1) > 0.01 && (
                      <Badge variant="outline" className="text-yellow-500 border-yellow-500">
                        Should = 1.0
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleNormalize(sport)}
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Normalize
                  </Button>
                </div>
                
                <div className="grid gap-3">
                  {sportWeights.map((weight) => (
                    <div key={weight.id} className="flex items-center gap-4 bg-muted/30 rounded-lg p-3">
                      <div className="w-32 shrink-0">
                        <p className="text-sm font-medium">
                          {WEIGHT_LABELS[weight.weight_key] || weight.weight_key}
                        </p>
                        {weight.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {weight.description}
                          </p>
                        )}
                      </div>
                      <div className="flex-1">
                        <Slider
                          value={[editedWeights[weight.id] ?? weight.weight_value]}
                          min={0}
                          max={0.5}
                          step={0.01}
                          onValueChange={([val]) => handleWeightChange(weight.id, val)}
                          className="w-full"
                        />
                      </div>
                      <div className="w-16">
                        <Input
                          type="number"
                          value={editedWeights[weight.id] ?? weight.weight_value}
                          onChange={(e) => handleWeightChange(weight.id, parseFloat(e.target.value) || 0)}
                          className="h-8 text-center text-sm"
                          step={0.01}
                          min={0}
                          max={1}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}

        {!isLoading && weights.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No weights configured. Run the migration to seed default weights.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
