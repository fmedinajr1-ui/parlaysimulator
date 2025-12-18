import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FeedCard } from '@/components/FeedCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  Legend
} from 'recharts';
import { 
  TrendingUp, 
  AlertTriangle, 
  Shield, 
  Flame,
  ChevronDown,
  Play,
  Loader2,
  Info
} from 'lucide-react';
import { useBankroll } from '@/hooks/useBankroll';
import { americanToDecimal } from '@/lib/kelly-calculator';
import { runWhatIfComparison, WhatIfResults, ProjectionResult } from '@/lib/kelly-simulator';
import { cn } from '@/lib/utils';

interface KellyWhatIfComparisonProps {
  winProbability: number; // 0-1
  americanOdds: number;
}

type TimePeriod = 30 | 60 | 90;

export function KellyWhatIfComparison({ winProbability, americanOdds }: KellyWhatIfComparisonProps) {
  const { settings } = useBankroll();
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(30);
  const [betsPerDay, setBetsPerDay] = useState(3);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<WhatIfResults | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const bankroll = settings?.bankrollAmount || 1000;
  const decimalOdds = americanToDecimal(americanOdds);

  const runSimulation = useCallback(() => {
    setIsRunning(true);
    
    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
      const simResults = runWhatIfComparison(
        bankroll,
        winProbability,
        decimalOdds,
        timePeriod,
        betsPerDay,
        1000
      );
      setResults(simResults);
      setIsRunning(false);
    }, 50);
  }, [bankroll, winProbability, decimalOdds, timePeriod, betsPerDay]);

  const formatCurrency = (value: number) => {
    if (value >= 10000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${value.toFixed(0)}`;
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  };

  const getRiskIcon = (result: ProjectionResult) => {
    if (result.kellyMultiplier >= 0.9) return <Flame className="w-4 h-4" />;
    if (result.kellyMultiplier >= 0.4) return <TrendingUp className="w-4 h-4" />;
    return <Shield className="w-4 h-4" />;
  };

  const getRiskColor = (result: ProjectionResult) => {
    if (result.kellyMultiplier >= 0.9) return 'text-destructive';
    if (result.kellyMultiplier >= 0.4) return 'text-primary';
    return 'text-muted-foreground';
  };

  const getRiskBg = (result: ProjectionResult) => {
    if (result.kellyMultiplier >= 0.9) return 'bg-destructive/10 border-destructive/30';
    if (result.kellyMultiplier >= 0.4) return 'bg-primary/10 border-primary/30';
    return 'bg-muted/10 border-muted/30';
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
        <p className="text-sm font-medium mb-2">Day {label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            <div 
              className="w-2 h-2 rounded-full" 
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium">{formatCurrency(entry.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <FeedCard>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h3 className="font-display text-lg">What-If Analysis</h3>
        </div>
        <Button 
          size="sm" 
          onClick={runSimulation}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-1" />
              Run
            </>
          )}
        </Button>
      </div>

      {/* Time Period Tabs */}
      <Tabs 
        value={timePeriod.toString()} 
        onValueChange={(v) => setTimePeriod(parseInt(v) as TimePeriod)}
        className="mb-4"
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="30">30 Days</TabsTrigger>
          <TabsTrigger value="60">60 Days</TabsTrigger>
          <TabsTrigger value="90">90 Days</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Assumptions Panel */}
      <Collapsible open={showAssumptions} onOpenChange={setShowAssumptions}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between mb-4">
            <span className="text-sm text-muted-foreground">
              Assumptions: {betsPerDay} bets/day • {(winProbability * 100).toFixed(0)}% win rate
            </span>
            <ChevronDown className={cn(
              "w-4 h-4 transition-transform",
              showAssumptions && "rotate-180"
            )} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pb-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Bets per Day</span>
              <span className="font-medium">{betsPerDay}</span>
            </div>
            <Slider
              value={[betsPerDay]}
              onValueChange={([v]) => setBetsPerDay(v)}
              min={1}
              max={10}
              step={1}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Results */}
      {!results ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Info className="w-8 h-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Click "Run" to simulate {timePeriod}-day projections
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Compares Full, Half, and Quarter Kelly strategies
          </p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Chart */}
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={results.combinedDailyData}>
                <defs>
                  <linearGradient id="fullKellyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="halfKellyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="quarterKellyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="day" 
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(v/1000).toFixed(1)}k`}
                  width={50}
                />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine 
                  y={bankroll} 
                  stroke="hsl(var(--border))" 
                  strokeDasharray="3 3"
                  label={{ value: 'Start', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                />
                <Area
                  type="monotone"
                  dataKey="fullKelly"
                  name="Full Kelly"
                  stroke="hsl(var(--chart-2))"
                  fill="url(#fullKellyGradient)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="halfKelly"
                  name="Half Kelly"
                  stroke="hsl(var(--primary))"
                  fill="url(#halfKellyGradient)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="quarterKelly"
                  name="Quarter Kelly"
                  stroke="hsl(var(--muted-foreground))"
                  fill="url(#quarterKellyGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Strategy Cards */}
          <div className="grid grid-cols-3 gap-2">
            {[results.fullKelly, results.halfKelly, results.quarterKelly].map((result) => (
              <motion.div
                key={result.label}
                className={cn(
                  "p-3 rounded-lg border text-center",
                  getRiskBg(result),
                  result.kellyMultiplier === 0.5 && "ring-2 ring-primary/50"
                )}
                whileHover={{ scale: 1.02 }}
              >
                <div className={cn("flex items-center justify-center gap-1 mb-1", getRiskColor(result))}>
                  {getRiskIcon(result)}
                  <span className="text-xs font-medium">{result.label}</span>
                </div>
                <div className="text-lg font-display font-bold">
                  {formatCurrency(result.finalBankroll.median)}
                </div>
                <div className={cn(
                  "text-sm font-medium",
                  result.growthPercent >= 0 ? "text-chart-2" : "text-destructive"
                )}>
                  {formatPercent(result.growthPercent)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  RoR: {result.riskOfRuin.toFixed(1)}%
                </div>
                {result.kellyMultiplier === 0.5 && (
                  <Badge variant="outline" className="mt-2 text-[10px] bg-primary/10">
                    Recommended
                  </Badge>
                )}
              </motion.div>
            ))}
          </div>

          {/* Risk Comparison */}
          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-medium">Risk Comparison</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div className="text-muted-foreground">Metric</div>
              <div className="text-center text-chart-2">Full</div>
              <div className="text-center text-primary">Half</div>
              <div className="text-center text-muted-foreground">Quarter</div>
              
              <div className="text-muted-foreground">Max Drawdown</div>
              <div className="text-center">{results.fullKelly.maxDrawdown.toFixed(0)}%</div>
              <div className="text-center">{results.halfKelly.maxDrawdown.toFixed(0)}%</div>
              <div className="text-center">{results.quarterKelly.maxDrawdown.toFixed(0)}%</div>
              
              <div className="text-muted-foreground">Profit Prob</div>
              <div className="text-center">{results.fullKelly.probabilityOfProfit.toFixed(0)}%</div>
              <div className="text-center">{results.halfKelly.probabilityOfProfit.toFixed(0)}%</div>
              <div className="text-center">{results.quarterKelly.probabilityOfProfit.toFixed(0)}%</div>
              
              <div className="text-muted-foreground">Best For</div>
              <div className="text-center">🎰</div>
              <div className="text-center">⚖️</div>
              <div className="text-center">🛡️</div>
            </div>
          </div>
        </motion.div>
      )}
    </FeedCard>
  );
}
