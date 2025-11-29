import { useState, useMemo } from 'react';
import { ParlaySimulation } from '@/types/parlay';
import { runComparativeSimulation, MonteCarloResult } from '@/lib/monte-carlo';
import { FeedCard } from '@/components/FeedCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend
} from 'recharts';
import { Dices, TrendingUp, Trophy, Loader2, RotateCcw, Zap, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PercentileBreakdown } from './PercentileBreakdown';
import { useIsMobile } from '@/hooks/use-mobile';

interface MonteCarloVisualizationProps {
  simulations: ParlaySimulation[];
}

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--neon-green))',
  'hsl(var(--neon-purple))',
  'hsl(var(--neon-orange))',
];

const LOSS_COLOR = 'hsl(var(--neon-red))';
const WIN_COLOR = 'hsl(var(--neon-green))';

export function MonteCarloVisualization({ simulations }: MonteCarloVisualizationProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<{
    results: MonteCarloResult[];
    comparisonData: { 
      name: string; 
      winRate: number; 
      lossRate: number; 
      expectedProfit: number; 
      potentialWin: number; 
      stake: number;
      pureWinRate: number;
      upsetImpact: number;
    }[];
    bestByWinRate: number;
    bestByExpectedProfit: number;
  } | null>(null);
  const [iterations, setIterations] = useState(100000);
  const isMobile = useIsMobile();

  const runSimulation = () => {
    setIsRunning(true);
    setTimeout(() => {
      const simulationResults = runComparativeSimulation(simulations, iterations);
      setResults(simulationResults);
      setIsRunning(false);
    }, 100);
  };

  const resetSimulation = () => {
    setResults(null);
  };

  // Prepare data for win rate comparison chart
  const winRateData = useMemo(() => {
    if (!results) return [];
    return results.comparisonData.map((d, idx) => ({
      name: isMobile ? `P${idx + 1}` : d.name,
      'Win Rate': d.winRate,
      'Loss Rate': d.lossRate,
      'Pure Odds': d.pureWinRate,
      isBest: idx === results.bestByWinRate,
    }));
  }, [results, isMobile]);

  // Prepare data for expected profit chart
  const profitData = useMemo(() => {
    if (!results) return [];
    return results.comparisonData.map((d, idx) => ({
      name: isMobile ? `P${idx + 1}` : d.name,
      'Expected Profit': d.expectedProfit,
      isBest: idx === results.bestByExpectedProfit,
    }));
  }, [results, isMobile]);

  // Prepare pie chart data for individual parlay
  const getPieData = (result: MonteCarloResult) => [
    { name: 'Win', value: result.wins, fill: WIN_COLOR },
    { name: 'Loss', value: result.losses, fill: LOSS_COLOR },
  ];

  if (simulations.length === 0) return null;

  return (
    <FeedCard className="p-3 sm:p-4 mt-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Dices className="w-5 h-5 text-primary" />
          <h3 className="font-display text-sm text-primary">MONTE CARLO</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] bg-neon-orange/10 text-neon-orange border-neon-orange/30">
            <Zap className="w-2.5 h-2.5 mr-0.5" />
            Upsets
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {iterations >= 1000 ? `${iterations/1000}K` : iterations} runs
          </Badge>
        </div>
      </div>

      {!results ? (
        <div className="space-y-4">
          <p className="text-xs sm:text-sm text-muted-foreground">
            Run {iterations >= 1000 ? `${iterations/1000}K` : iterations} simulations with <span className="text-neon-orange font-medium">upset factors</span>.
          </p>
          
          {/* Upset Factor Info - Condensed on mobile */}
          <div className="rounded-lg p-2.5 sm:p-3 bg-neon-orange/10 border border-neon-orange/20">
            <div className="flex items-center gap-2 mb-2">
              <Flame className="w-4 h-4 text-neon-orange" />
              <span className="text-[10px] sm:text-xs font-medium text-neon-orange">UPSET FACTORS</span>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[10px] sm:text-xs text-muted-foreground">
              <span>• Underdogs: +3-6% boost</span>
              <span>• Favorites: 2.5% upset risk</span>
              <span>• 5% "Chaos Days"</span>
              <span>• 15% underdog boost</span>
            </div>
          </div>
          
          {/* Iteration selector */}
          <div className="flex gap-2 flex-wrap">
            {[10000, 50000, 100000].map((iter) => (
              <Button
                key={iter}
                variant={iterations === iter ? "default" : "outline"}
                size="sm"
                onClick={() => setIterations(iter)}
                className={cn("text-xs", iterations === iter && "bg-primary")}
              >
                {iter >= 1000 ? `${iter/1000}K` : iter}
              </Button>
            ))}
          </div>

          <Button
            onClick={runSimulation}
            className="w-full gradient-fire"
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Dices className="w-4 h-4 mr-2" />
                Run Simulation
              </>
            )}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {/* Upset Stats Summary - Simplified on mobile */}
          <div className="rounded-lg p-2.5 sm:p-3 bg-neon-orange/10 border border-neon-orange/20">
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <Zap className="w-4 h-4 text-neon-orange" />
              <h4 className="text-xs sm:text-sm font-medium text-neon-orange">Upset Impact</h4>
            </div>
            <div className={cn(
              "grid gap-2 sm:gap-3",
              results.results.length <= 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"
            )}>
              {results.results.map((result, idx) => (
                <div key={idx} className="text-center">
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground mb-0.5">P{idx + 1}</p>
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-[10px] sm:text-xs text-muted-foreground">{result.upsetStats.pureOddsWinRate.toFixed(1)}%</span>
                    <span className="text-neon-green text-[10px] sm:text-xs">→</span>
                    <span className="text-xs sm:text-sm font-bold text-neon-green">{result.upsetStats.adjustedWinRate.toFixed(1)}%</span>
                  </div>
                  <Badge 
                    className={cn(
                      "text-[8px] sm:text-[10px] mt-0.5",
                      result.upsetStats.upsetImpact > 0 
                        ? "bg-neon-green/20 text-neon-green border-neon-green/30" 
                        : "bg-destructive/20 text-destructive border-destructive/30"
                    )}
                  >
                    {result.upsetStats.upsetImpact > 0 ? '+' : ''}{result.upsetStats.upsetImpact.toFixed(2)}%
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Win Rate Comparison */}
          <div>
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <Trophy className="w-4 h-4 text-neon-yellow" />
              <h4 className="text-xs sm:text-sm font-medium">Win Rate (With Upsets)</h4>
            </div>
            <div className="h-36 sm:h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={winRateData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    type="number" 
                    domain={[0, 100]} 
                    tickFormatter={(v) => `${v}%`}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={isMobile ? 10 : 12}
                  />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    width={isMobile ? 30 : 70}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={isMobile ? 10 : 12}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: isMobile ? '10px' : '12px',
                    }}
                    formatter={(value: number, name: string) => [
                      `${value.toFixed(2)}%`,
                      name
                    ]}
                  />
                  <Bar dataKey="Win Rate" stackId="a" radius={[0, 4, 4, 0]}>
                    {winRateData.map((entry, index) => (
                      <Cell 
                        key={`win-${index}`} 
                        fill={entry.isBest ? WIN_COLOR : 'hsl(var(--primary))'} 
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="Loss Rate" stackId="a" fill={LOSS_COLOR} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Expected Profit Comparison */}
          <div>
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <TrendingUp className="w-4 h-4 text-neon-green" />
              <h4 className="text-xs sm:text-sm font-medium">Expected Profit</h4>
            </div>
            <div className="h-32 sm:h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={profitData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="name" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={isMobile ? 10 : 12}
                  />
                  <YAxis 
                    tickFormatter={(v) => `$${v.toFixed(0)}`}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={isMobile ? 10 : 12}
                    width={isMobile ? 35 : 50}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: isMobile ? '10px' : '12px',
                    }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Expected Profit']}
                  />
                  <Bar dataKey="Expected Profit" radius={[4, 4, 0, 0]}>
                    {profitData.map((entry, index) => (
                      <Cell 
                        key={`profit-${index}`} 
                        fill={entry['Expected Profit'] >= 0 ? WIN_COLOR : LOSS_COLOR} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Individual Parlay Breakdowns - Responsive grid */}
          <div>
            <h4 className="text-xs sm:text-sm font-medium mb-2 sm:mb-3">Individual Results</h4>
            <div className={cn(
              "grid gap-2 sm:gap-3",
              results.results.length <= 2 ? "grid-cols-2" : "grid-cols-2"
            )}>
              {results.results.map((result, idx) => (
                <div 
                  key={idx} 
                  className={cn(
                    "rounded-lg p-2 sm:p-3 bg-muted/30",
                    idx === results.bestByWinRate && "ring-2 ring-primary"
                  )}
                >
                  <div className="flex items-center justify-between mb-1 sm:mb-2">
                    <span className="text-[10px] sm:text-xs font-medium">P{idx + 1}</span>
                    <div className="flex items-center gap-1">
                      {result.upsetStats.upsetImpact > 0.5 && (
                        <Badge className="text-[8px] sm:text-[10px] bg-neon-orange/20 text-neon-orange border-neon-orange/30 px-1">
                          <Zap className="w-2 h-2" />
                        </Badge>
                      )}
                      {idx === results.bestByWinRate && (
                        <Badge className="text-[8px] sm:text-xs bg-primary px-1 sm:px-2">Best</Badge>
                      )}
                    </div>
                  </div>
                  <div className="h-16 sm:h-24">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={getPieData(result)}
                          cx="50%"
                          cy="50%"
                          innerRadius={isMobile ? 12 : 20}
                          outerRadius={isMobile ? 24 : 35}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          {getPieData(result).map((entry, i) => (
                            <Cell key={`cell-${i}`} fill={entry.fill} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-center">
                    <p className="text-sm sm:text-lg font-bold text-primary">
                      {result.winRate.toFixed(1)}%
                    </p>
                    <p className="text-[9px] sm:text-xs text-muted-foreground">
                      {result.wins.toLocaleString()} wins
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Percentile Breakdown */}
          <PercentileBreakdown 
            results={results.results} 
            stakes={simulations.map(s => s.stake)} 
          />

          {/* Stats Summary - Condensed on mobile */}
          <div className="rounded-lg p-2.5 sm:p-3 bg-primary/10 border border-primary/30">
            <h4 className="text-xs sm:text-sm font-medium mb-2 text-primary">Summary</h4>
            <div className="grid grid-cols-2 gap-2 text-[10px] sm:text-xs">
              <div>
                <span className="text-muted-foreground">Best Win Rate:</span>
                <p className="font-bold">
                  P{results.bestByWinRate + 1} ({results.results[results.bestByWinRate].winRate.toFixed(1)}%)
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Best Profit:</span>
                <p className="font-bold">
                  P{results.bestByExpectedProfit + 1} (${results.results[results.bestByExpectedProfit].expectedProfit.toFixed(2)})
                </p>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            onClick={resetSimulation}
            className="w-full"
            size={isMobile ? "sm" : "default"}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Run New Simulation
          </Button>
        </div>
      )}
    </FeedCard>
  );
}
