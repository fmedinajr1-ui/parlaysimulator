import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X, ArrowLeftRight, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRiskMode } from '@/contexts/RiskModeContext';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

export type AlertType = 'hedge' | 'edge_flip' | 'role_change' | 'spread_shift';

export interface HedgeBookLine {
  line: number;
  bookmaker: string;
}

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
  smartBookmaker?: string;
  originalSide?: string;
  originalLine?: number;
  allBookLines?: HedgeBookLine[];
}

const ALERT_CONFIG: Record<AlertType, { label: string; color: string; Icon: React.ElementType }> = {
  hedge: { label: 'HEDGE OPPORTUNITY', color: '--warroom-gold', Icon: Zap },
  edge_flip: { label: 'EDGE FLIP', color: '--warroom-ice', Icon: ArrowLeftRight },
  role_change: { label: 'ROLE CHANGE', color: '--warroom-danger', Icon: AlertTriangle },
  spread_shift: { label: 'SPREAD SHIFT', color: '--warroom-gold', Icon: AlertTriangle },
};

function HelpTip({ children, tip, side = 'top' }: { children: React.ReactNode; tip: string; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="max-w-[200px] text-xs">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const BOOK_SHORT: Record<string, string> = {
  hardrockbet: 'HR', fanduel: 'FD', draftkings: 'DK',
  betmgm: 'MGM', caesars: 'CZR', pointsbet: 'PB',
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

          // Derive hedge vs original sides
          const origSide = opp.originalSide || (opp.side === 'OVER' ? 'UNDER' : 'OVER');
          const origLine = opp.originalLine ?? opp.liveLine;
          const hedgeSide = opp.side;

          // "Why" explanation
          const gap = Math.abs(opp.liveProjection - opp.liveLine).toFixed(1);
          const direction = opp.liveProjection >= opp.liveLine ? 'above' : 'below';
          const whyText = `Proj ${opp.liveProjection.toFixed(1)} is ${gap} ${direction} line (${opp.liveLine}). ${
            alertType === 'hedge' ? 'Hedging locks in protection.' : ''
          }`;

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

              <div className="space-y-1.5 text-xs">
                <p className="font-semibold text-foreground">{opp.playerName} — {opp.propType}</p>

                {/* Original bet vs hedge side */}
                {alertType === 'hedge' && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">Your bet:</span>
                    <span className="font-bold text-foreground">{origSide} {origLine}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className={cn(
                      'font-black',
                      hedgeSide === 'OVER'
                        ? 'text-[hsl(var(--warroom-green))]'
                        : 'text-[hsl(var(--warroom-danger))]'
                    )}>
                      Hedge: {hedgeSide} {opp.liveLine}
                    </span>
                  </div>
                )}

                {/* Non-hedge alert: just show the action */}
                {alertType !== 'hedge' && (
                  <p className={cn(
                    'text-sm font-black tracking-wide',
                    opp.side === 'OVER'
                      ? 'text-[hsl(var(--warroom-green))]'
                      : 'text-[hsl(var(--warroom-danger))]'
                  )}>
                    {opp.suggestedAction}
                  </p>
                )}

                {/* Why explanation */}
                <div className="flex items-start gap-1 text-[10px] text-muted-foreground bg-[hsl(var(--warroom-card-border)/0.2)] rounded px-1.5 py-1">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{opp.alertMessage || whyText}</span>
                </div>

                {/* Alt Lines across books */}
                {opp.allBookLines && opp.allBookLines.length > 1 && (
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-muted-foreground font-medium">Alt Lines:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {opp.allBookLines.map((bl, idx) => {
                        const short = BOOK_SHORT[bl.bookmaker] || bl.bookmaker;
                        const isBest = bl.line === opp.liveLine;
                        return (
                          <span
                            key={idx}
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded border',
                              isBest
                                ? 'border-[hsl(var(--warroom-gold)/0.5)] bg-[hsl(var(--warroom-gold)/0.1)] text-[hsl(var(--warroom-gold))] font-bold'
                                : 'border-[hsl(var(--warroom-card-border))] text-muted-foreground'
                            )}
                          >
                            {short}: {bl.line}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {opp.smartBookmaker && (
                  <HelpTip tip="The sportsbook offering the best line for this recommendation." side="left">
                    <p className="text-[10px] text-[hsl(var(--warroom-ice))] font-medium cursor-help border-b border-dotted border-muted-foreground/30 w-fit">
                      Best via {BOOK_SHORT[opp.smartBookmaker] || opp.smartBookmaker}
                    </p>
                  </HelpTip>
                )}

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                  <HelpTip tip="AI's projected final stat for this player based on current pace." side="left">
                    <span className="cursor-help border-b border-dotted border-muted-foreground/30">Projection:</span>
                  </HelpTip>
                  <span className="text-foreground font-medium">{opp.liveProjection.toFixed(1)}</span>
                  {alertType === 'hedge' && (
                    <>
                      <HelpTip tip="Kelly Criterion bet sizing: the mathematically optimal percentage of your bankroll to wager." side="left">
                        <span className="cursor-help border-b border-dotted border-muted-foreground/30">Kelly:</span>
                      </HelpTip>
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
                  {alertType === 'hedge' ? `Hedge ${hedgeSide} ${opp.liveLine}` : 'Acknowledge'}
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
