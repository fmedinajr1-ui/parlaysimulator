import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Settings, 
  Save, 
  RotateCcw, 
  Zap, 
  Target, 
  Shield, 
  Clock, 
  Scale,
  AlertTriangle,
  Activity
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface ConfigItem {
  id: string;
  config_key: string;
  config_value: number;
  description: string | null;
  category: string | null;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  movement: <Activity className="w-4 h-4" />,
  thresholds: <Target className="w-4 h-4" />,
  formula: <Scale className="w-4 h-4" />,
  weights: <Clock className="w-4 h-4" />,
  signals: <Zap className="w-4 h-4" />,
  traps: <Shield className="w-4 h-4" />,
};

const DEFAULT_VALUES: Record<string, number> = {
  BASE_MOVE_SHARP: 40,
  BASE_NOISE: 25,
  PICK_SES_THRESHOLD: 30,
  FADE_SES_THRESHOLD: -30,
  PICK_SHARP_PCT: 65,
  FADE_SHARP_PCT: 35,
  LOGISTIC_K: 25,
  MW_EXTREME: 0.4,
  MW_LARGE: 1.0,
  MW_MODERATE: 0.7,
  MW_SMALL: 0.3,
  MW_MINIMAL: 0.1,
  TW_LATE: 1.25,
  TW_MID: 1.0,
  TW_EARLY: 0.6,
  SIGNAL_LINE_AND_JUICE: 25,
  SIGNAL_STEAM_MOVE: 20,
  SIGNAL_LATE_MONEY: 15,
  SIGNAL_RLM: 25,
  SIGNAL_CONSENSUS_HIGH: 20,
  SIGNAL_CLV_POSITIVE: 10,
  SIGNAL_MULTI_MARKET: 15,
  TRAP_PRICE_ONLY: 25,
  TRAP_EARLY_MORNING: 15,
  TRAP_BOTH_SIDES: 30,
  TRAP_INSIGNIFICANT: 20,
  TRAP_FAVORITE_SHORT: 20,
  TRAP_EXTREME_JUICE: 15,
  TRAP_ISOLATED: 20,
  TRAP_CLV_NEGATIVE: 10,
};

export function SharpEngineConfigPanel() {
  const [config, setConfig] = useState<ConfigItem[]>([]);
  const [editedValues, setEditedValues] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchConfig = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('sharp_engine_config')
        .select('*')
        .order('category', { ascending: true });

      if (error) throw error;
      setConfig(data || []);
      
      // Initialize edited values
      const values: Record<string, number> = {};
      (data || []).forEach(item => {
        values[item.config_key] = item.config_value;
      });
      setEditedValues(values);
    } catch (error) {
      console.error('Error fetching config:', error);
      toast.error('Failed to load configuration');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleValueChange = (key: string, value: number) => {
    setEditedValues(prev => ({ ...prev, [key]: value }));
  };

  const hasChanges = () => {
    return config.some(item => item.config_value !== editedValues[item.config_key]);
  };

  const saveChanges = async () => {
    setIsSaving(true);
    try {
      const updates = config
        .filter(item => item.config_value !== editedValues[item.config_key])
        .map(item => ({
          id: item.id,
          config_key: item.config_key,
          config_value: editedValues[item.config_key],
          description: item.description,
          category: item.category,
        }));

      for (const update of updates) {
        const { error } = await supabase
          .from('sharp_engine_config')
          .update({ config_value: update.config_value })
          .eq('id', update.id);

        if (error) throw error;
      }

      toast.success(`Updated ${updates.length} configuration values`);
      await fetchConfig();
    } catch (error) {
      console.error('Error saving config:', error);
      toast.error('Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const resetToDefaults = () => {
    setEditedValues(DEFAULT_VALUES);
  };

  const resetCategory = (category: string) => {
    const categoryItems = config.filter(item => item.category === category);
    const updates: Record<string, number> = { ...editedValues };
    categoryItems.forEach(item => {
      if (DEFAULT_VALUES[item.config_key] !== undefined) {
        updates[item.config_key] = DEFAULT_VALUES[item.config_key];
      }
    });
    setEditedValues(updates);
  };

  // Group config by category
  const categories = [...new Set(config.map(item => item.category || 'general'))];

  // Calculate sample SES for preview
  const sampleSP = (editedValues.MW_LARGE || 1) * (editedValues.TW_LATE || 1.25) * (editedValues.BASE_MOVE_SHARP || 40) + 
                   (editedValues.SIGNAL_LINE_AND_JUICE || 25) + (editedValues.SIGNAL_LATE_MONEY || 15);
  const sampleTP = 0.4 * 0.5 * (editedValues.BASE_NOISE || 25);
  const sampleSES = sampleSP - sampleTP;
  const sampleSharpPct = Math.round(100 / (1 + Math.exp(-sampleSES / (editedValues.LOGISTIC_K || 25))));

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Sharp Engine v2 Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Sharp Engine v2 Configuration
            </CardTitle>
            <CardDescription className="mt-1">
              Tune the dual-force model parameters for optimal signal detection
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetToDefaults}
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              Reset All
            </Button>
            <Button
              size="sm"
              onClick={saveChanges}
              disabled={!hasChanges() || isSaving}
            >
              <Save className="w-4 h-4 mr-1" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Live Preview */}
        <div className="mb-6 p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">Live Preview (Sample: Large move, late window, line+juice moved)</span>
          </div>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-green-500">{sampleSP.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">Sharp Pressure</div>
            </div>
            <div>
              <div className="text-xl font-bold text-red-500">{sampleTP.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">Trap Pressure</div>
            </div>
            <div>
              <div className={`text-xl font-bold ${sampleSES >= 30 ? 'text-green-500' : sampleSES <= -30 ? 'text-red-500' : 'text-yellow-500'}`}>
                {sampleSES > 0 ? '+' : ''}{sampleSES.toFixed(0)}
              </div>
              <div className="text-xs text-muted-foreground">SES</div>
            </div>
            <div>
              <div className="text-xl font-bold">{sampleSharpPct}%</div>
              <div className="text-xs text-muted-foreground">Sharp%</div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="thresholds" className="space-y-4">
          <TabsList className="grid w-full grid-cols-6">
            {categories.map(cat => (
              <TabsTrigger key={cat} value={cat} className="flex items-center gap-1">
                {CATEGORY_ICONS[cat]}
                <span className="capitalize text-xs">{cat}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map(category => (
            <TabsContent key={category} value={category} className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium capitalize flex items-center gap-2">
                  {CATEGORY_ICONS[category]}
                  {category} Parameters
                </h3>
                <Button variant="ghost" size="sm" onClick={() => resetCategory(category)}>
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Reset
                </Button>
              </div>
              
              <div className="grid gap-4">
                {config
                  .filter(item => (item.category || 'general') === category)
                  .map(item => {
                    const value = editedValues[item.config_key] ?? item.config_value;
                    const defaultVal = DEFAULT_VALUES[item.config_key];
                    const isChanged = value !== item.config_value;
                    const isWeight = item.config_key.startsWith('MW_') || item.config_key.startsWith('TW_');
                    const isThreshold = item.config_key.includes('THRESHOLD') || item.config_key.includes('PCT');
                    
                    let min = 0, max = 100, step = 1;
                    if (isWeight) {
                      min = 0; max = 2; step = 0.05;
                    } else if (item.config_key === 'LOGISTIC_K') {
                      min = 5; max = 50; step = 1;
                    } else if (item.config_key.includes('THRESHOLD')) {
                      min = -100; max = 100; step = 5;
                    }

                    return (
                      <div key={item.id} className="p-4 border rounded-lg bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Label className="font-mono text-sm">{item.config_key}</Label>
                            {isChanged && (
                              <Badge variant="secondary" className="text-xs">Modified</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Default: {defaultVal}</span>
                            <Input
                              type="number"
                              value={value}
                              onChange={(e) => handleValueChange(item.config_key, parseFloat(e.target.value) || 0)}
                              className="w-24 text-right"
                              step={step}
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">{item.description}</p>
                        <Slider
                          value={[value]}
                          onValueChange={([v]) => handleValueChange(item.config_key, v)}
                          min={min}
                          max={max}
                          step={step}
                          className="mt-2"
                        />
                      </div>
                    );
                  })}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Formula Reference */}
        <div className="mt-6 p-4 bg-muted/30 rounded-lg border">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            Formula Reference
          </h4>
          <div className="text-xs font-mono space-y-1 text-muted-foreground">
            <p>SP = (MW × TW × BASE_MOVE_SHARP) + Σ(Sharp Signal Bonuses)</p>
            <p>TP = (NW × (0.5 + 0.5 × EarlyFlag) × BASE_NOISE) + Σ(Trap Penalties)</p>
            <p>SES = SP − TP</p>
            <p>Sharp% = 100 / (1 + e^(−SES / LOGISTIC_K))</p>
            <p className="mt-2 text-primary">
              SHARP: SES ≥ PICK_SES_THRESHOLD AND Sharp% ≥ PICK_SHARP_PCT
            </p>
            <p className="text-destructive">
              TRAP: SES ≤ FADE_SES_THRESHOLD AND Sharp% ≤ FADE_SHARP_PCT
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
