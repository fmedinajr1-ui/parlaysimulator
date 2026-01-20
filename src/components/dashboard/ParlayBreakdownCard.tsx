import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Zap, Flame, Skull, Trophy } from "lucide-react";
import { LegOutcomeRow, type LegData } from "./LegOutcomeRow";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface ParlayData {
  id: string;
  date: string;
  system: 'sharp' | 'heat';
  type: string;
  outcome: 'won' | 'lost' | 'push' | 'pending';
  legs: LegData[];
  total_odds?: number;
}

interface ParlayBreakdownCardProps {
  parlay: ParlayData;
  defaultOpen?: boolean;
}

function getSystemIcon(system: 'sharp' | 'heat') {
  return system === 'sharp' ? Zap : Flame;
}

function getSystemColor(system: 'sharp' | 'heat') {
  return system === 'sharp' ? 'text-neon-yellow' : 'text-orange-500';
}

function normalizeOutcome(outcome: string | null | undefined): 'won' | 'lost' | 'push' | 'pending' {
  if (!outcome) return 'pending';
  const normalized = outcome.toLowerCase().trim();
  if (normalized === 'hit' || normalized === 'won') return 'won';
  if (normalized === 'miss' || normalized === 'lost') return 'lost';
  if (normalized === 'push') return 'push';
  return 'pending';
}

export function ParlayBreakdownCard({ parlay, defaultOpen = false }: ParlayBreakdownCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  const SystemIcon = getSystemIcon(parlay.system);
  const systemColor = getSystemColor(parlay.system);
  
  const legsWithOutcome = parlay.legs.map(leg => ({
    ...leg,
    normalizedOutcome: normalizeOutcome(leg.outcome)
  }));
  
  const wonLegs = legsWithOutcome.filter(l => l.normalizedOutcome === 'won').length;
  const lostLegs = legsWithOutcome.filter(l => l.normalizedOutcome === 'lost').length;
  const totalLegs = parlay.legs.length;
  const settledLegs = wonLegs + lostLegs;
  const hitRate = settledLegs > 0 ? (wonLegs / settledLegs) * 100 : 0;
  
  // Find the leg(s) that busted the parlay
  const bustedLegs = legsWithOutcome.filter(l => l.normalizedOutcome === 'lost');
  const firstBustedLeg = bustedLegs[0];
  
  const outcomeConfig = {
    won: {
      borderClass: 'border-green-500/50',
      bgClass: 'bg-green-500/5',
      label: 'WON',
      labelClass: 'text-green-500',
    },
    lost: {
      borderClass: 'border-red-500/50',
      bgClass: 'bg-red-500/5',
      label: 'LOST',
      labelClass: 'text-red-500',
    },
    push: {
      borderClass: 'border-yellow-500/50',
      bgClass: 'bg-yellow-500/5',
      label: 'PUSH',
      labelClass: 'text-yellow-500',
    },
    pending: {
      borderClass: 'border-muted',
      bgClass: 'bg-muted/5',
      label: 'PENDING',
      labelClass: 'text-muted-foreground',
    },
  };
  
  const config = outcomeConfig[parlay.outcome];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        "rounded-lg border transition-all",
        config.borderClass,
        config.bgClass
      )}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/10 transition-colors rounded-t-lg">
            <div className="flex items-center gap-2">
              <SystemIcon className={cn("h-4 w-4", systemColor)} />
              <span className="font-medium text-sm">
                {parlay.system === 'sharp' ? 'Sharp' : 'Heat'} {parlay.type}
              </span>
              <span className={cn(
                "text-xs font-bold px-2 py-0.5 rounded",
                config.labelClass,
                parlay.outcome === 'won' && "bg-green-500/20",
                parlay.outcome === 'lost' && "bg-red-500/20",
                parlay.outcome === 'push' && "bg-yellow-500/20",
                parlay.outcome === 'pending' && "bg-muted"
              )}>
                {config.label}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {wonLegs}/{totalLegs} legs
              </span>
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3">
            {/* Progress bar */}
            <div className="space-y-1">
              <Progress value={hitRate} className="h-1.5" />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{wonLegs}W - {lostLegs}L</span>
                {settledLegs > 0 && <span>{hitRate.toFixed(0)}% hit rate</span>}
              </div>
            </div>
            
            {/* Legs breakdown */}
            <div className="space-y-0">
              {parlay.legs.map((leg, idx) => (
                <LegOutcomeRow 
                  key={`${parlay.id}-leg-${idx}`}
                  leg={leg}
                  isLastLeg={idx === parlay.legs.length - 1}
                />
              ))}
            </div>
            
            {/* Footer */}
            {parlay.outcome === 'lost' && firstBustedLeg && (
              <div className="flex items-center gap-2 pt-2 border-t border-red-500/20">
                <Skull className="h-4 w-4 text-red-500" />
                <span className="text-xs text-red-500 font-medium">
                  BUSTED BY: {firstBustedLeg.player} ({firstBustedLeg.actual_value ?? '?'} actual)
                </span>
              </div>
            )}
            
            {parlay.outcome === 'won' && (
              <div className="flex items-center gap-2 pt-2 border-t border-green-500/20">
                <Trophy className="h-4 w-4 text-green-500" />
                <span className="text-xs text-green-500 font-medium">
                  ALL {totalLegs} LEGS HIT! 🎯
                </span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
