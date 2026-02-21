import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRiskMode } from '@/contexts/RiskModeContext';

export interface HedgeOpportunity {
  id: string;
  playerName: string;
  propType: string;
  liveProjection: number;
  liveLine: number;
  edge: number;
  kellySuggestion: number;
  evPercent: number;
}

interface HedgeSlideInProps {
  opportunities: HedgeOpportunity[];
}

export function HedgeSlideIn({ opportunities }: HedgeSlideInProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { kellyMultiplier } = useRiskMode();

  const visible = opportunities.filter((o) => !dismissed.has(o.id));

  return (
    <div className="fixed right-0 top-1/3 z-50 flex flex-col gap-2 pr-2 max-w-xs pointer-events-none">
      <AnimatePresence>
        {visible.slice(0, 3).map((opp) => {
          const adjKelly = Math.round(opp.kellySuggestion * kellyMultiplier * 100) / 100;

          return (
            <motion.div
              key={opp.id}
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              className="warroom-card warroom-glow-gold p-3 space-y-2 pointer-events-auto"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-[hsl(var(--warroom-gold))]" />
                  <span className="text-xs font-bold text-[hsl(var(--warroom-gold))]">
                    HEDGE OPPORTUNITY
                  </span>
                </div>
                <button
                  onClick={() => setDismissed((s) => new Set(s).add(opp.id))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-1 text-xs">
                <p className="font-semibold text-foreground">{opp.playerName}</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                  <span>Prop:</span>
                  <span className="text-foreground">{opp.propType}</span>
                  <span>Projection:</span>
                  <span className="text-foreground font-medium">{opp.liveProjection.toFixed(1)}</span>
                  <span>Live Line:</span>
                  <span className="text-foreground">{opp.liveLine.toFixed(1)}</span>
                  <span>Edge:</span>
                  <span className="text-[hsl(var(--warroom-green))] font-bold">+{opp.edge.toFixed(1)}</span>
                  <span>Kelly:</span>
                  <span className="text-[hsl(var(--warroom-gold))] font-bold">{adjKelly}%</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-7 text-[10px] bg-[hsl(var(--warroom-gold))] text-black hover:bg-[hsl(var(--warroom-gold)/0.9)]"
                  onClick={() => setDismissed((s) => new Set(s).add(opp.id))}
                >
                  Hedge Now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7 text-[10px] border-[hsl(var(--warroom-card-border))]"
                  onClick={() => setDismissed((s) => new Set(s).add(opp.id))}
                >
                  Dismiss
                </Button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
