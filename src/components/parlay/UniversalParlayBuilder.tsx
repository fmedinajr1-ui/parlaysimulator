import React, { useState } from 'react';
import { ChevronUp, ChevronDown, Trash2, LineChart, GitCompare, Save, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { ParlayLegCard } from './ParlayLegCard';
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
  } = useParlayBuilder();

  const [stake, setStake] = useState<string>('10');
  const [isSaving, setIsSaving] = useState(false);

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
                {/* Source Breakdown */}
                <div className="px-3 pb-2 flex flex-wrap gap-1">
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
                      />
                    ))}
                  </div>
                </ScrollArea>

                {/* Stats */}
                <div className="px-3 py-2 bg-muted/50 border-t border-border/50">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Win Probability</span>
                    <span className={cn(
                      "font-bold",
                      winProbability < 5 ? "text-red-500" : 
                      winProbability < 15 ? "text-orange-500" : 
                      winProbability < 30 ? "text-yellow-500" : "text-green-500"
                    )}>
                      {winProbability.toFixed(1)}%
                    </span>
                  </div>
                  
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
                <div className="p-3 grid grid-cols-4 gap-2 border-t border-border/50">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs"
                    onClick={analyzeParlay}
                  >
                    <LineChart className="h-3 w-3 mr-1" />
                    Analyze
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs"
                    onClick={compareParlay}
                  >
                    <GitCompare className="h-3 w-3 mr-1" />
                    Compare
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-9 text-xs"
                    onClick={handleSave}
                    disabled={isSaving || stakeNum <= 0}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-9 text-xs"
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
