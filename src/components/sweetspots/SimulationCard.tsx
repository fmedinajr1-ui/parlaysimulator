/**
 * SimulationCard.tsx
 * 
 * Displays Monte Carlo simulation results for parlay validation.
 * Shows win probability, edge, Sharpe ratio, Kelly stake, and recommendation.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Dices, 
  TrendingUp, 
  Target, 
  Gauge, 
  DollarSign, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Loader2,
  Sparkles,
  BarChart3,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { 
  SimulatedParlay, 
  SimulationProgress, 
  SimulationMode 
} from '@/hooks/useSimulatedParlayBuilder';

// ============= TYPES =============

interface SimulationCardProps {
  // State
  isSimulating: boolean;
  progress: SimulationProgress;
  bestParlay: SimulatedParlay | null;
  viableParlays: SimulatedParlay[];
  
  // Actions
  onRunSimulation: (mode: SimulationMode) => void;
  onCancel: () => void;
  
  // Config
  currentMode: SimulationMode;
  candidateCount: number;
  legCount: number;
}

// ============= HELPERS =============

const MODE_LABELS: Record<SimulationMode, { label: string; iterations: string; icon: React.ReactNode }> = {
  quick: { label: 'Quick', iterations: '5K', icon: <Zap size={14} /> },
  standard: { label: 'Standard', iterations: '25K', icon: <BarChart3 size={14} /> },
  deep: { label: 'Deep', iterations: '50K', icon: <Sparkles size={14} /> },
};

function getRecommendationStyle(rec: string) {
  if (rec === 'strong_bet') return { bg: 'bg-green-500/20', text: 'text-green-400', icon: CheckCircle2 };
  if (rec === 'value_bet') return { bg: 'bg-teal-500/20', text: 'text-teal-400', icon: TrendingUp };
  if (rec === 'fade') return { bg: 'bg-red-500/20', text: 'text-red-400', icon: XCircle };
  return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: AlertTriangle };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ============= COMPONENT =============

export function SimulationCard({
  isSimulating,
  progress,
  bestParlay,
  viableParlays,
  onRunSimulation,
  onCancel,
  currentMode,
  candidateCount,
  legCount,
}: SimulationCardProps) {
  const [selectedMode, setSelectedMode] = useState<SimulationMode>(currentMode);
  
  const hasResults = bestParlay !== null || viableParlays.length > 0;
  const simulation = bestParlay?.simulation;
  
  const progressPercent = progress.combinationsTotal > 0 
    ? (progress.combinationsSimulated / progress.combinationsTotal) * 100 
    : 0;
  
  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Dices className="text-primary" size={18} />
            Monte Carlo Simulation
          </CardTitle>
          {hasResults && (
            <span className="text-xs text-muted-foreground">
              {viableParlays.length} viable / {progress.combinationsTotal} tested
            </span>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Mode Selection & Run Button */}
        {!isSimulating && !hasResults && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Run simulation to validate {legCount}-leg parlay from {candidateCount} candidates
            </p>
            
            <div className="flex gap-2">
              {(Object.keys(MODE_LABELS) as SimulationMode[]).map((mode) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={selectedMode === mode ? 'default' : 'outline'}
                  onClick={() => setSelectedMode(mode)}
                  className="flex-1 gap-1.5"
                >
                  {MODE_LABELS[mode].icon}
                  {MODE_LABELS[mode].label}
                  <span className="text-xs opacity-70">({MODE_LABELS[mode].iterations})</span>
                </Button>
              ))}
            </div>
            
            <Button 
              onClick={() => onRunSimulation(selectedMode)}
              disabled={candidateCount < legCount}
              className="w-full gap-2"
            >
              <Dices size={16} />
              Run Simulation
            </Button>
          </div>
        )}
        
        {/* Simulation Progress */}
        {isSimulating && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-primary" />
                <span className="text-sm font-medium capitalize">
                  {progress.stage === 'filtering' && 'Generating combinations...'}
                  {progress.stage === 'simulating' && 'Running simulations...'}
                  {progress.stage === 'ranking' && 'Ranking results...'}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            </div>
            
            <Progress value={progressPercent} className="h-2" />
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{progress.combinationsSimulated} / {progress.combinationsTotal} combinations</span>
              <span>{progress.viableParlays} viable found</span>
            </div>
          </div>
        )}
        
        {/* Results Display */}
        {hasResults && !isSimulating && simulation && (
          <div className="space-y-4">
            {/* Recommendation Badge */}
            {(() => {
              const style = getRecommendationStyle(simulation.recommendation);
              const Icon = style.icon;
              return (
                <div className={cn(
                  "flex items-center justify-center gap-2 py-3 rounded-lg",
                  style.bg
                )}>
                  <Icon size={20} className={style.text} />
                  <span className={cn("font-bold text-lg uppercase", style.text)}>
                    {simulation.recommendation.replace('_', ' ')}
                  </span>
                </div>
              );
            })()}
            
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Win Probability */}
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Target size={12} />
                  Win Probability
                </div>
                <div className="text-xl font-bold text-foreground">
                  {formatPercent(simulation.hybridWinRate)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {progress.combinationsTotal.toLocaleString()} combos tested
                </div>
              </div>
              
              {/* Edge */}
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <TrendingUp size={12} />
                  Edge vs Implied
                </div>
                <div className={cn(
                  "text-xl font-bold",
                  simulation.overallEdge >= 0.05 ? "text-green-400" : 
                  simulation.overallEdge >= 0 ? "text-yellow-400" : "text-red-400"
                )}>
                  {simulation.overallEdge >= 0 ? '+' : ''}{formatPercent(simulation.overallEdge)}
                </div>
                <div className="text-xs text-muted-foreground">
                  EV: {simulation.expectedValue >= 0 ? '+' : ''}{simulation.expectedValue.toFixed(3)}
                </div>
              </div>
              
              {/* Sharpe Ratio */}
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Gauge size={12} />
                  Sharpe Ratio
                </div>
                <div className={cn(
                  "text-xl font-bold",
                  simulation.sharpeRatio >= 1.0 ? "text-green-400" :
                  simulation.sharpeRatio >= 0.5 ? "text-yellow-400" : "text-red-400"
                )}>
                  {simulation.sharpeRatio.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Risk-adjusted return
                </div>
              </div>
              
              {/* Kelly Fraction */}
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <DollarSign size={12} />
                  Kelly Stake
                </div>
                <div className={cn(
                  "text-xl font-bold",
                  simulation.kellyFraction >= 0.02 ? "text-green-400" :
                  simulation.kellyFraction > 0 ? "text-yellow-400" : "text-red-400"
                )}>
                  {formatPercent(simulation.kellyFraction)}
                </div>
                <div className="text-xs text-muted-foreground">
                  of bankroll
                </div>
              </div>
            </div>
            
            {/* Confidence Level */}
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Simulation Confidence</span>
                <span className="text-sm font-medium">{formatPercent(simulation.confidenceLevel)}</span>
              </div>
              <Progress 
                value={simulation.confidenceLevel * 100} 
                className="h-1.5"
              />
            </div>
            
            {/* Viability Reasons */}
            {bestParlay && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Validation checks:</p>
                <div className="flex flex-wrap gap-1.5">
                  {bestParlay.viabilityReasons.map((reason, i) => (
                    <span
                      key={i}
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        reason.startsWith('✓') 
                          ? "bg-green-500/20 text-green-400"
                          : "bg-red-500/20 text-red-400"
                      )}
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* Run Again Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRunSimulation(selectedMode)}
              className="w-full gap-2"
            >
              <Dices size={14} />
              Run Again
            </Button>
          </div>
        )}
        
        {/* No viable parlays found */}
        {hasResults && !isSimulating && !simulation && (
          <div className="text-center py-4">
            <XCircle size={32} className="mx-auto text-red-400 mb-2" />
            <p className="text-sm font-medium text-foreground">No Viable Parlays Found</p>
            <p className="text-xs text-muted-foreground mt-1">
              All {progress.combinationsTotal} combinations failed viability checks.
              Try different candidates or lower thresholds.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRunSimulation(selectedMode)}
              className="mt-3 gap-2"
            >
              <Dices size={14} />
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
