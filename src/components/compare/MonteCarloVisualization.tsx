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
import { Dices, TrendingUp, Trophy, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PercentileBreakdown } from './PercentileBreakdown';

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
    comparisonData: { name: string; winRate: number; lossRate: number; expectedProfit: number; potentialWin: number; stake: number }[];
    bestByWinRate: number;
    bestByExpectedProfit: number;
  } | null>(null);
  const [iterations, setIterations] = useState(10000);

  const runSimulation = () => {
    setIsRunning(true);
    // Use setTimeout to allow UI to update
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
      name: d.name,
      'Win Rate': d.winRate,
      'Loss Rate': d.lossRate,
      isBest: idx === results.bestByWinRate,
    }));
  }, [results]);

  // Prepare data for expected profit chart
  const profitData = useMemo(() => {
    if (!results) return [];
    return results.comparisonData.map((d, idx) => ({
      name: d.name,
      'Expected Profit': d.expectedProfit,
      isBest: idx === results.bestByExpectedProfit,
    }));
  }, [results]);

  // Prepare pie chart data for individual parlay
  const getPieData = (result: MonteCarloResult) => [
    { name: 'Win', value: result.wins, fill: WIN_COLOR },
    { name: 'Loss', value: result.losses, fill: LOSS_COLOR },
  ];

  if (simulations.length === 0) return null;

  return (
    <FeedCard className="p-4 mt-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Dices className="w-5 h-5 text-primary" />
          <h3 className="font-display text-sm text-primary">MONTE CARLO SIMULATION</h3>
        </div>
        <Badge variant="outline" className="text-xs">
          {iterations.toLocaleString()} iterations
        </Badge>
      </div>

      {!results ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Run thousands of simulated bets to see probability distributions and expected outcomes for each parlay.
          </p>
          
          {/* Iteration selector */}
          <div className="flex gap-2 flex-wrap">
            {[1000, 10000, 50000, 100000].map((iter) => (
              <Button
                key={iter}
                variant={iterations === iter ? "default" : "outline"}
                size="sm"
                onClick={() => setIterations(iter)}
                className={cn(iterations === iter && "bg-primary")}
              >
                {iter.toLocaleString()}
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
                Running Simulation...
              </>
            ) : (
              <>
                <Dices className="w-4 h-4 mr-2" />
                Run Monte Carlo Simulation
              </>
            )}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Win Rate Comparison */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-4 h-4 text-neon-yellow" />
              <h4 className="text-sm font-medium">Win Rate Distribution</h4>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={winRateData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    type="number" 
                    domain={[0, 100]} 
                    tickFormatter={(v) => `${v}%`}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    width={70}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number) => [`${value.toFixed(2)}%`]}
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
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-neon-green" />
              <h4 className="text-sm font-medium">Expected Profit per Bet</h4>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={profitData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="name" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis 
                    tickFormatter={(v) => `$${v.toFixed(0)}`}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
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

          {/* Individual Parlay Breakdowns */}
          <div>
            <h4 className="text-sm font-medium mb-3">Individual Distributions</h4>
            <div className="grid grid-cols-2 gap-3">
              {results.results.map((result, idx) => (
                <div 
                  key={idx} 
                  className={cn(
                    "rounded-lg p-3 bg-muted/30",
                    idx === results.bestByWinRate && "ring-2 ring-primary"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">Parlay {idx + 1}</span>
                    {idx === results.bestByWinRate && (
                      <Badge className="text-xs bg-primary">Best</Badge>
                    )}
                  </div>
                  <div className="h-24">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={getPieData(result)}
                          cx="50%"
                          cy="50%"
                          innerRadius={20}
                          outerRadius={35}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          {getPieData(result).map((entry, i) => (
                            <Cell key={`cell-${i}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Legend 
                          iconSize={8}
                          wrapperStyle={{ fontSize: '10px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-center mt-1">
                    <p className="text-lg font-bold text-primary">
                      {result.winRate.toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {result.wins.toLocaleString()} / {result.simulations.toLocaleString()} wins
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

          {/* Stats Summary */}
          <div className="rounded-lg p-3 bg-primary/10 border border-primary/30">
            <h4 className="text-sm font-medium mb-2 text-primary">Simulation Summary</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Best Win Rate:</span>
                <p className="font-bold">
                  Parlay {results.bestByWinRate + 1} ({results.results[results.bestByWinRate].winRate.toFixed(1)}%)
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Best Expected Profit:</span>
                <p className="font-bold">
                  Parlay {results.bestByExpectedProfit + 1} (${results.results[results.bestByExpectedProfit].expectedProfit.toFixed(2)})
                </p>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            onClick={resetSimulation}
            className="w-full"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Run New Simulation
          </Button>
        </div>
      )}
    </FeedCard>
  );
}
