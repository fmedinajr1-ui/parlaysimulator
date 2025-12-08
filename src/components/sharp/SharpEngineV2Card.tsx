import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  ChevronDown, 
  Zap, 
  Target,
  Shield,
  Activity,
  RefreshCw,
  Info,
  Plus
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { AddToParlayButton } from '@/components/parlay/AddToParlayButton';

interface DetectedSignal {
  type: 'sharp' | 'trap';
  signal: string;
  value: number;
}

interface LineMovementV2 {
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
  sharp_pressure: number;
  trap_pressure: number;
  sharp_edge_score: number;
  sharp_probability: number;
  movement_weight: number;
  time_weight: number;
  detected_signals: DetectedSignal[];
  engine_version: string;
  recommendation: string;
  movement_authenticity: string;
  detected_at: string;
  commence_time: string | null;
  books_consensus: number | null;
}

const SIGNAL_EXPLANATIONS: Record<string, string> = {
  LINE_AND_JUICE_MOVED: 'Both the line (spread) and juice (price) moved together - strong sharp indicator',
  STEAM_MOVE_DETECTED: 'Rapid, significant price movement detected close to game time',
  LATE_MONEY_WINDOW: 'Movement occurred in the critical 1-3 hour window before game',
  REVERSE_LINE_MOVEMENT: 'Line moved opposite to public betting percentages - classic sharp signal',
  MARKET_CONSENSUS_HIGH: '60%+ of books moved in same direction - coordinated sharp action',
  CLV_POSITIVE: 'Closing Line Value is positive - you got better price than close',
  MULTI_MARKET_ALIGNMENT: 'Spread, ML, and totals all moved in aligned direction',
  SINGLE_SIDE_MOVEMENT: 'Only one side of the line moved - targeted sharp action',
  PRICE_ONLY_MOVE: 'Price moved without line change - often indicates trap/noise',
  EARLY_MORNING_ACTION: 'Movement occurred 6+ hours before game - lower reliability',
  BOTH_SIDES_MOVED: 'Both over and under moved - likely market adjustment, not sharp',
  INSIGNIFICANT_MOVEMENT: 'Price change under 8 points - minimal signal strength',
  FAVORITE_SHORTENING: 'Heavy favorite getting even shorter - public trap pattern',
  EXTREME_JUICE_WARNING: 'Price at -150 or worse - increased vig/house edge',
  ISOLATED_SIGNAL: 'Less than 40% of books moved - isolated action, lower confidence',
  CLV_NEGATIVE: 'Closing Line Value is negative - price moved against you',
};

function formatOdds(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function getSESColor(ses: number): string {
  if (ses >= 30) return 'text-green-500';
  if (ses <= -30) return 'text-red-500';
  return 'text-yellow-500';
}

function getSESBgColor(ses: number): string {
  if (ses >= 30) return 'bg-green-500/10 border-green-500/30';
  if (ses <= -30) return 'bg-red-500/10 border-red-500/30';
  return 'bg-yellow-500/10 border-yellow-500/30';
}

function getLabelBadge(label: string) {
  switch (label) {
    case 'SHARP':
      return <Badge className="bg-green-500 hover:bg-green-600 text-white"><TrendingUp className="w-3 h-3 mr-1" />SHARP PICK</Badge>;
    case 'TRAP':
      return <Badge className="bg-red-500 hover:bg-red-600 text-white"><TrendingDown className="w-3 h-3 mr-1" />TRAP / FADE</Badge>;
    default:
      return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black"><AlertTriangle className="w-3 h-3 mr-1" />CAUTION</Badge>;
  }
}

function MovementCard({ movement }: { movement: LineMovementV2 }) {
  const [isOpen, setIsOpen] = useState(false);
  const label = movement.sharp_edge_score >= 30 && movement.sharp_probability >= 65 
    ? 'SHARP' 
    : movement.sharp_edge_score <= -30 && movement.sharp_probability <= 35 
      ? 'TRAP' 
      : 'CAUTION';
  
  const sharpSignals = (movement.detected_signals || []).filter(s => s.type === 'sharp');
  const trapSignals = (movement.detected_signals || []).filter(s => s.type === 'trap');
  const SP_move = movement.movement_weight * movement.time_weight * 40; // BASE_MOVE_SHARP
  const SP_signals = movement.sharp_pressure - SP_move;

  return (
    <Card className={`border ${getSESBgColor(movement.sharp_edge_score)} transition-all hover:shadow-lg`}>
      <CardContent className="p-4">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {movement.sport.replace('basketball_', '').toUpperCase()}
            </Badge>
            <span className="text-xs text-muted-foreground">{movement.bookmaker}</span>
          </div>
          {getLabelBadge(label)}
        </div>

        {/* Main Content */}
        <div className="mb-3">
          <p className="font-medium text-sm">{movement.description}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {movement.outcome_name} • {movement.market_type}
          </p>
        </div>

        {/* SES and Sharp% Display */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {/* Sharp Edge Score */}
          <div className={`text-center p-3 rounded-lg border ${getSESBgColor(movement.sharp_edge_score)}`}>
            <div className={`text-2xl font-bold ${getSESColor(movement.sharp_edge_score)}`}>
              {movement.sharp_edge_score > 0 ? '+' : ''}{movement.sharp_edge_score.toFixed(0)}
            </div>
            <div className="text-xs text-muted-foreground">SES</div>
          </div>

          {/* Sharp Probability */}
          <div className="text-center p-3 rounded-lg bg-card border">
            <div className="text-2xl font-bold">{movement.sharp_probability.toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">Sharp%</div>
          </div>

          {/* Price Change */}
          <div className="text-center p-3 rounded-lg bg-card border">
            <div className={`text-xl font-bold ${movement.price_change > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatOdds(movement.old_price)} → {formatOdds(movement.new_price)}
            </div>
            <div className="text-xs text-muted-foreground">
              {movement.price_change > 0 ? '+' : ''}{movement.price_change} pts
            </div>
          </div>
        </div>

        {/* Pressure Breakdown */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-green-500/10 p-3 rounded-lg border border-green-500/20">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-green-400">Sharp Pressure</span>
            </div>
            <div className="text-xl font-bold text-green-500">{movement.sharp_pressure.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">
              Move: {SP_move.toFixed(1)} + Signals: {SP_signals.toFixed(0)}
            </div>
          </div>
          
          <div className="bg-red-500/10 p-3 rounded-lg border border-red-500/20">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-red-500" />
              <span className="text-sm font-medium text-red-400">Trap Pressure</span>
            </div>
            <div className="text-xl font-bold text-red-500">{movement.trap_pressure.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">
              Noise + Trap Signals
            </div>
          </div>
        </div>

        {/* Signal Pills */}
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between">
              <span className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                {sharpSignals.length} Sharp • {trapSignals.length} Trap Signals
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="flex flex-wrap gap-2">
              {sharpSignals.map((signal, idx) => (
                <TooltipProvider key={`sharp-${idx}`}>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
                        <Zap className="w-3 h-3 mr-1" />
                        {signal.signal.replace(/_/g, ' ')} (+{signal.value})
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>{SIGNAL_EXPLANATIONS[signal.signal] || signal.signal}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
              {trapSignals.map((signal, idx) => (
                <TooltipProvider key={`trap-${idx}`}>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {signal.signal.replace(/_/g, ' ')} (-{signal.value})
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>{SIGNAL_EXPLANATIONS[signal.signal] || signal.signal}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Add to Parlay - Only for Sharp picks */}
        {label === 'SHARP' && (
          <div className="mt-3 pt-3 border-t">
            <AddToParlayButton
              description={`${movement.description} - ${movement.outcome_name}`}
              odds={movement.new_price}
              source="sharp"
              sport={movement.sport}
              confidenceScore={movement.sharp_probability}
              sourceData={{ 
                sharpEdgeScore: movement.sharp_edge_score, 
                sharpProbability: movement.sharp_probability,
                recommendation: movement.recommendation 
              }}
              className="w-full"
            />
          </div>
        )}

        {/* Metadata Footer */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs text-muted-foreground">
          <span>{movement.books_consensus || 1} book{(movement.books_consensus || 1) > 1 ? 's' : ''} consensus</span>
          <span>MW: {movement.movement_weight.toFixed(2)} • TW: {movement.time_weight.toFixed(2)}</span>
          <Badge variant="secondary" className="text-[10px]">{movement.engine_version}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export function SharpEngineV2Card({ limit = 10 }: { limit?: number }) {
  const [movements, setMovements] = useState<LineMovementV2[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  const fetchMovements = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('line_movements')
        .select('*')
        .eq('engine_version', 'v2')
        .order('detected_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      
      // Parse detected_signals from JSON
      const parsed = (data || []).map(m => ({
        ...m,
        detected_signals: Array.isArray(m.detected_signals) 
          ? (m.detected_signals as unknown as DetectedSignal[])
          : []
      }));
      
      setMovements(parsed);
    } catch (error) {
      console.error('Error fetching v2 movements:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const runBatchReanalyze = async () => {
    setIsReanalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sharp-engine-v2', {
        body: { action: 'batch_reanalyze' }
      });

      if (error) throw error;
      console.log('Batch reanalyze result:', data);
      await fetchMovements();
    } catch (error) {
      console.error('Error running batch reanalyze:', error);
    } finally {
      setIsReanalyzing(false);
    }
  };

  useEffect(() => {
    fetchMovements();
  }, [limit]);

  // Stats
  const sharpCount = movements.filter(m => m.sharp_edge_score >= 30 && m.sharp_probability >= 65).length;
  const trapCount = movements.filter(m => m.sharp_edge_score <= -30 && m.sharp_probability <= 35).length;
  const cautionCount = movements.length - sharpCount - trapCount;
  const avgSES = movements.length > 0 
    ? movements.reduce((sum, m) => sum + m.sharp_edge_score, 0) / movements.length 
    : 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Sharp Money Engine v2
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Sharp Money Engine v2
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={runBatchReanalyze}
              disabled={isReanalyzing}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isReanalyzing ? 'animate-spin' : ''}`} />
              Re-analyze All
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-4 h-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="font-semibold mb-1">Dual-Force Model</p>
                  <p className="text-xs">SES = Sharp Pressure (SP) - Trap Pressure (TP)</p>
                  <p className="text-xs mt-1">Sharp% = 1 / (1 + e^(-SES/K))</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-card p-3 rounded-lg border text-center">
            <div className="text-2xl font-bold">{movements.length}</div>
            <div className="text-xs text-muted-foreground">Analyzed</div>
          </div>
          <div className="bg-green-500/10 p-3 rounded-lg border border-green-500/30 text-center">
            <div className="text-2xl font-bold text-green-500">{sharpCount}</div>
            <div className="text-xs text-green-400">Sharp Picks</div>
          </div>
          <div className="bg-red-500/10 p-3 rounded-lg border border-red-500/30 text-center">
            <div className="text-2xl font-bold text-red-500">{trapCount}</div>
            <div className="text-xs text-red-400">Traps</div>
          </div>
          <div className="bg-card p-3 rounded-lg border text-center">
            <div className={`text-2xl font-bold ${getSESColor(avgSES)}`}>
              {avgSES > 0 ? '+' : ''}{avgSES.toFixed(0)}
            </div>
            <div className="text-xs text-muted-foreground">Avg SES</div>
          </div>
        </div>

        {/* Movement Cards */}
        {movements.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No v2 engine movements yet</p>
            <p className="text-sm">Click "Re-analyze All" to process existing movements</p>
          </div>
        ) : (
          <div className="space-y-4">
            {movements.map(movement => (
              <MovementCard key={movement.id} movement={movement} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
