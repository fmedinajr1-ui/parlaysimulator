import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UniversalLeg, SOURCE_LABELS } from '@/types/universal-parlay';
import { SportsCoachingSignal } from '@/hooks/useSportsCoachingSignals';
import { CoachingWarningBadge } from './CoachingWarningBadge';
import { MarketSignalBadge, type MarketSignal } from './MarketSignalBadge';
import { TrapProbabilityBadge } from './TrapProbabilityBadge';
import { cn } from '@/lib/utils';

interface TrapSignal {
  signal: string;
  points: number;
  reason: string;
  category: 'trap' | 'safe';
}

interface TrapProbabilityData {
  trap_probability: number;
  risk_label: 'Low' | 'Medium' | 'High';
  recommendation: 'Play' | 'Reduce Line' | 'Avoid';
  explanation: string;
  triggered_signals?: TrapSignal[];
}

interface ParlayLegCardProps {
  leg: UniversalLeg;
  onRemove: (id: string) => void;
  coachingSignal?: SportsCoachingSignal;
  marketSignal?: MarketSignal | null;
  trapProbability?: TrapProbabilityData | null;
}

export const ParlayLegCard = ({ leg, onRemove, coachingSignal, marketSignal, trapProbability }: ParlayLegCardProps) => {
  const sourceInfo = SOURCE_LABELS[leg.source];
  
  const formatOdds = (odds: number) => {
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  // Determine if we should show a border highlight based on coaching signal or trap
  const getBorderStyle = () => {
    // High trap risk takes priority
    if (trapProbability?.risk_label === 'High') return 'border-red-500/50';
    if (trapProbability?.risk_label === 'Medium') return 'border-yellow-500/40';
    
    if (!coachingSignal) return 'border-border/50';
    if (coachingSignal.recommendation === 'FADE') return 'border-red-500/40';
    if (coachingSignal.recommendation === 'PICK') return 'border-green-500/40';
    return 'border-yellow-500/40';
  };

  const showTrapWarning = trapProbability && trapProbability.risk_label !== 'Low';

  return (
    <div className={cn(
      "flex flex-col gap-1.5 p-2 rounded-lg bg-card/50 border",
      getBorderStyle()
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={cn("text-xs font-medium", sourceInfo.color)}>
              {sourceInfo.emoji} {sourceInfo.label}
            </span>
            {leg.sport && (
              <span className="text-[10px] text-muted-foreground uppercase">
                {leg.sport.replace('_', ' ')}
              </span>
            )}
            {leg.confidenceScore && leg.source === 'godmode' && (
              <span className="text-[10px] font-medium text-purple-400">
                {Math.round(leg.confidenceScore)}% score
              </span>
            )}
          </div>
          <p className="text-sm font-medium truncate">{leg.description}</p>
          {leg.playerName && leg.propType && leg.line && (
            <p className="text-xs text-muted-foreground truncate">
              {leg.playerName} {leg.side?.toUpperCase()} {leg.line} {leg.propType}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            "text-sm font-bold",
            leg.odds > 0 ? "text-green-500" : "text-muted-foreground"
          )}>
            {formatOdds(leg.odds)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(leg.id)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      
      {/* Signal Badges Row */}
      {(coachingSignal || marketSignal || showTrapWarning) && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Trap probability badge (compact) */}
          {showTrapWarning && trapProbability && (
            <TrapProbabilityBadge
              trapProbability={trapProbability.trap_probability}
              riskLabel={trapProbability.risk_label}
              recommendation={trapProbability.recommendation}
              explanation={trapProbability.explanation}
              triggeredSignals={trapProbability.triggered_signals}
              compact
            />
          )}
          {marketSignal && (
            <MarketSignalBadge signal={marketSignal} compact />
          )}
          {coachingSignal && (
            <CoachingWarningBadge signal={coachingSignal} compact />
          )}
        </div>
      )}
    </div>
  );
};
