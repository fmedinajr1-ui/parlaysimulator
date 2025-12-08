import React from 'react';
import { Plus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { ParlaySource } from '@/types/universal-parlay';
import { cn } from '@/lib/utils';

interface AddToParlayButtonProps {
  description: string;
  odds: number;
  source: ParlaySource;
  playerName?: string;
  propType?: string;
  line?: number;
  side?: 'over' | 'under';
  sport?: string;
  eventId?: string;
  confidenceScore?: number;
  sourceData?: Record<string, unknown>;
  variant?: 'default' | 'icon' | 'compact';
  className?: string;
}

export const AddToParlayButton = ({
  description,
  odds,
  source,
  playerName,
  propType,
  line,
  side,
  sport,
  eventId,
  confidenceScore,
  sourceData,
  variant = 'default',
  className,
}: AddToParlayButtonProps) => {
  const { addLeg, hasLeg } = useParlayBuilder();
  
  const isAdded = hasLeg(description);

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAdded) return;
    
    addLeg({
      description,
      odds,
      source,
      playerName,
      propType,
      line,
      side,
      sport,
      eventId,
      confidenceScore,
      sourceData,
    });
  };

  if (variant === 'icon') {
    return (
      <Button
        size="icon"
        variant={isAdded ? "secondary" : "outline"}
        onClick={handleAdd}
        disabled={isAdded}
        className={cn(
          "h-8 w-8 shrink-0",
          isAdded && "bg-primary/20 border-primary",
          className
        )}
      >
        {isAdded ? <Check className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4" />}
      </Button>
    );
  }

  if (variant === 'compact') {
    return (
      <Button
        size="sm"
        variant={isAdded ? "secondary" : "outline"}
        onClick={handleAdd}
        disabled={isAdded}
        className={cn(
          "h-7 px-2 text-xs",
          isAdded && "bg-primary/20 border-primary",
          className
        )}
      >
        {isAdded ? <Check className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
        {isAdded ? "Added" : "Add"}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant={isAdded ? "secondary" : "default"}
      onClick={handleAdd}
      disabled={isAdded}
      className={cn(
        isAdded && "bg-primary/20 border-primary",
        className
      )}
    >
      {isAdded ? (
        <>
          <Check className="h-4 w-4 mr-1" />
          Added to Parlay
        </>
      ) : (
        <>
          <Plus className="h-4 w-4 mr-1" />
          Add to Parlay
        </>
      )}
    </Button>
  );
};
