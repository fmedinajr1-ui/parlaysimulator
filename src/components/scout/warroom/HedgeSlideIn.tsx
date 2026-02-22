import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X, ArrowLeftRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRiskMode } from '@/contexts/RiskModeContext';

export type AlertType = 'hedge' | 'edge_flip' | 'role_change' | 'spread_shift';

export interface HedgeOpportunity {
  id: string;
  playerName: string;
  propType: string;
  liveProjection: number;
  liveLine: number;
  edge: number;
  kellySuggestion: number;
  evPercent: number;
  side: string;
  suggestedAction: string;
  alertType?: AlertType;
  alertMessage?: string;
}

const ALERT_CONFIG: Record<AlertType, { label: string; color: string; Icon: React.ElementType }> = {
  hedge: { label: 'HEDGE OPPORTUNITY', color: '--warroom-gold', Icon: Zap },
  edge_flip: { label: 'EDGE FLIP', color: '--warroom-ice', Icon: ArrowLeftRight },
  role_change: { label: 'ROLE CHANGE', color: '--warroom-danger', Icon: AlertTriangle },
  spread_shift: { label: 'SPREAD SHIFT', color: '--warroom-gold', Icon: AlertTriangle },
};

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
          const alertType = opp.alertType ?? 'hedge';
          const config = ALERT_CONFIG[alertType];
          const AlertIcon = config.Icon;

          return (
            <motion.div
              key={opp.id}
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              className={cn(
                'warroom-card p-3 space-y-2 pointer-events-auto',
                alertType === 'hedge' && 'warroom-glow-gold',
                alertType === 'edge_flip' && 'warroom-glow-ice',
                alertType === 'role_change' && 'warroom-glow-danger',
                alertType === 'spread_shift' && 'warroom-glow-gold',
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <AlertIcon className={`w-4 h-4 text-[hsl(var(${config.color}))]`} />
                  <span className={`text-xs font-bold text-[hsl(var(${config.color}))]`}>
                    {config.label}
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
                <p className={cn(
                  'text-sm font-black tracking-wide',
                  opp.side === 'OVER'
                    ? 'text-[hsl(var(--warroom-green))]'
                    : 'text-[hsl(var(--warroom-danger))]'
                )}>
                  {opp.suggestedAction}
                </p>
                {opp.alertMessage && (
                  <p className="text-muted-foreground text-[10px]">{opp.alertMessage}</p>
                )}
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                  <span>Prop:</span>
                  <span className="text-foreground">{opp.propType}</span>
                  <span>Projection:</span>
                  <span className="text-foreground font-medium">{opp.liveProjection.toFixed(1)}</span>
                  {alertType === 'hedge' && (
                    <>
                      <span>Kelly:</span>
                      <span className="text-[hsl(var(--warroom-gold))] font-bold">{adjKelly}%</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  className={cn(
                    'flex-1 h-7 text-[10px]',
                    `bg-[hsl(var(${config.color}))] text-black hover:bg-[hsl(var(${config.color})/0.9)]`
                  )}
                  onClick={() => setDismissed((s) => new Set(s).add(opp.id))}
                >
                  {alertType === 'hedge' ? `Take ${opp.side} ${opp.liveLine}` : 'Acknowledge'}
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
