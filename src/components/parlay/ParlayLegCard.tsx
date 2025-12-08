import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UniversalLeg, SOURCE_LABELS } from '@/types/universal-parlay';
import { cn } from '@/lib/utils';

interface ParlayLegCardProps {
  leg: UniversalLeg;
  onRemove: (id: string) => void;
}

export const ParlayLegCard = ({ leg, onRemove }: ParlayLegCardProps) => {
  const sourceInfo = SOURCE_LABELS[leg.source];
  
  const formatOdds = (odds: number) => {
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-card/50 border border-border/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={cn("text-xs font-medium", sourceInfo.color)}>
            {sourceInfo.emoji} {sourceInfo.label}
          </span>
          {leg.sport && (
            <span className="text-[10px] text-muted-foreground uppercase">
              {leg.sport}
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
  );
};
