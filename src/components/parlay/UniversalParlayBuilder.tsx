import React, { useState } from 'react';
import { ChevronUp, ChevronDown, Trash2, LineChart, GitCompare, Save, Target, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { ParlayLegCard } from './ParlayLegCard';
import { CoachingAlertBanner } from './CoachingAlertBanner';
import { LiveProbabilitySimulator } from './LiveProbabilitySimulator';
import { useSportsCoachingSignals, SPORT_ICONS } from '@/hooks/useSportsCoachingSignals';
import { SOURCE_LABELS } from '@/types/universal-parlay';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export const UniversalParlayBuilder = () => {
  const {
    legs,
    isExpanded,
    legCount,
    combinedOdds,
    winProbability,
    toggleExpanded,
    removeLeg,
    clearParlay,
    saveParlay,
    analyzeParlay,
    compareParlay,
    compareToSharps,
  } = useParlayBuilder();

  const [stake, setStake] = useState<string>('10');
  const [isSaving, setIsSaving] = useState(false);
  
  // Fetch coaching signals for all sports - must be called before any early returns (React Rules of Hooks)
  const { signals, isLoading: coachingLoading, totalLegsWithCoaching, legCountBySport, getSignalForLeg, criticalWarnings } = useSportsCoachingSignals(legs);

  // Early return AFTER all hooks are called
  if (legCount === 0) return null;

  const stakeNum = parseFloat(stake) || 0;
  const decimalOdds = combinedOdds > 0 
    ? (combinedOdds / 100) + 1 
    : (100 / Math.abs(combinedOdds)) + 1;
  const potentialPayout = stakeNum * decimalOdds;

  const formatOdds = (odds: number) => {
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  const handleSave = async () => {
    if (stakeNum <= 0) return;
    setIsSaving(true);
    await saveParlay(stakeNum);
    setIsSaving(false);
  };

  // Group legs by source for summary
  const sourceBreakdown = legs.reduce((acc, leg) => {
    acc[leg.source] = (acc[leg.source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Show coaching indicator in header if NBA legs have warnings
  const hasCoachingWarnings = criticalWarnings.length > 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-20 left-2 right-2 z-40 md:left-auto md:right-4 md:max-w-sm"
      >
        <Card className="bg-background/95 backdrop-blur-lg border-primary/30 shadow-xl overflow-hidden">
          {/* Header - Always visible */}
          <button
            onClick={toggleExpanded}
            className="w-full p-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <span className="font-bold text-sm">PARLAY BUILDER</span>
              <span className="bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 rounded-full">
                {legCount}
              </span>
              {/* Coaching warning indicator in collapsed state */}
              {!isExpanded && hasCoachingWarnings && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium animate-pulse">
                  ⚠️ {criticalWarnings.length}
                </span>
              )}
              {!isExpanded && totalLegsWithCoaching > 0 && !hasCoachingWarnings && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary">
                  🏆 {totalLegsWithCoaching}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-sm font-bold",
                combinedOdds > 0 ? "text-green-500" : "text-muted-foreground"
              )}>
                {formatOdds(combinedOdds)}
              </span>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </div>
          </button>

          {/* Expanded Content */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Coaching Alert Banner */}
                {totalLegsWithCoaching > 0 && (
                  <CoachingAlertBanner signals={signals} isLoading={coachingLoading} legCountBySport={legCountBySport} />
                )}
                
                {/* Source Breakdown */}
                <div className="px-3 pb-2 pt-2 flex flex-wrap gap-1">
                  {Object.entries(sourceBreakdown).map(([source, count]) => (
                    <span
                      key={source}
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full bg-muted",
                        SOURCE_LABELS[source as keyof typeof SOURCE_LABELS]?.color
                      )}
                    >
                      {count} {SOURCE_LABELS[source as keyof typeof SOURCE_LABELS]?.label}
                    </span>
                  ))}
                </div>

                {/* Legs List */}
                <ScrollArea className="max-h-60">
                  <div className="space-y-2 px-3 pb-2">
                    {legs.map(leg => (
                      <ParlayLegCard
                        key={leg.id}
                        leg={leg}
                        onRemove={removeLeg}
                        coachingSignal={getSignalForLeg(leg.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>

                {/* Live Probability Simulator */}
                <div className="px-3 pt-2">
                  <LiveProbabilitySimulator 
                    legs={legs.map(leg => ({ odds: leg.odds }))} 
                  />
                </div>

                {/* Stats */}
                <div className="px-3 py-2 bg-muted/50 border-t border-border/50">
                  <div className="flex gap-2 items-center mb-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground uppercase mb-0.5 block">
                        Stake
                      </label>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                        <Input
                          type="number"
                          value={stake}
                          onChange={(e) => setStake(e.target.value)}
                          className="h-8 pl-5 text-sm"
                          min="0"
                          step="5"
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground uppercase mb-0.5 block">
                        To Win
                      </label>
                      <div className="h-8 px-2 bg-primary/10 border border-primary/20 rounded-md flex items-center">
                        <span className="text-sm font-bold text-primary">
                          ${potentialPayout.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-3 grid grid-cols-5 gap-1.5 border-t border-border/50">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-[10px] px-1"
                    onClick={analyzeParlay}
                  >
                    <LineChart className="h-3 w-3 mr-0.5" />
                    Analyze
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-[10px] px-1"
                    onClick={compareParlay}
                  >
                    <GitCompare className="h-3 w-3 mr-0.5" />
                    Compare
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-[10px] px-1 text-primary border-primary/50"
                    onClick={compareToSharps}
                  >
                    <Shield className="h-3 w-3 mr-0.5" />
                    Sharps
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-9 text-[10px] px-1"
                    onClick={handleSave}
                    disabled={isSaving || stakeNum <= 0}
                  >
                    <Save className="h-3 w-3 mr-0.5" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-9 text-[10px] px-1"
                    onClick={clearParlay}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
};
