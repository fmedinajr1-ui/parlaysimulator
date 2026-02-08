/**
 * BotParlayCard.tsx
 * 
 * Displays a single bot-generated parlay with simulation metrics.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, Target, Percent, DollarSign, CheckCircle, XCircle, Clock, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { BotParlay, BotLeg } from '@/hooks/useBotEngine';

interface BotParlayCardProps {
  parlay: BotParlay;
}

export function BotParlayCard({ parlay }: BotParlayCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const getOutcomeStyle = (outcome: string) => {
    switch (outcome) {
      case 'won':
        return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'lost':
        return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'partial':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
      case 'push':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getOutcomeIcon = (outcome: string) => {
    switch (outcome) {
      case 'won':
        return <CheckCircle className="w-4 h-4" />;
      case 'lost':
        return <XCircle className="w-4 h-4" />;
      case 'push':
        return <Minus className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getLegOutcomeStyle = (outcome?: string) => {
    switch (outcome) {
      case 'hit':
        return 'text-green-400';
      case 'miss':
        return 'text-red-400';
      case 'push':
        return 'text-blue-400';
      default:
        return 'text-muted-foreground';
    }
  };

  const legs = parlay.legs as BotLeg[];

  return (
    <Card className={cn(
      "transition-all duration-200",
      parlay.outcome === 'won' && "border-green-500/30 bg-green-500/5",
      parlay.outcome === 'lost' && "border-red-500/30 bg-red-500/5"
    )}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full p-4 h-auto flex items-start justify-between hover:bg-transparent"
          >
            <div className="flex-1 text-left space-y-2">
              {/* Header Row */}
              <div className="flex items-center gap-2">
                <Badge className={getOutcomeStyle(parlay.outcome)}>
                  {getOutcomeIcon(parlay.outcome)}
                  <span className="ml-1 capitalize">{parlay.outcome}</span>
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {parlay.leg_count}-leg parlay
                </span>
              </div>
              
              {/* Metrics Row */}
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-primary" />
                  <span className="text-muted-foreground">Win:</span>
                  <span className="font-medium">
                    {((parlay.simulated_win_rate || 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-muted-foreground">Edge:</span>
                  <span className="font-medium text-green-400">
                    +{((parlay.simulated_edge || 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-muted-foreground">Sharpe:</span>
                  <span className="font-medium">
                    {(parlay.simulated_sharpe || 0).toFixed(2)}
                  </span>
                </div>
              </div>
              
              {/* Stake/Payout Row */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span className="text-muted-foreground">Stake:</span>
                  <span className="font-medium">${parlay.simulated_stake || 50}</span>
                </div>
                {parlay.outcome === 'won' && (
                  <div className="flex items-center gap-1.5 text-green-400">
                    <span>→</span>
                    <span className="font-medium">+${(parlay.profit_loss || 0).toFixed(0)}</span>
                  </div>
                )}
                {parlay.outcome === 'lost' && (
                  <div className="flex items-center gap-1.5 text-red-400">
                    <span>→</span>
                    <span className="font-medium">-${parlay.simulated_stake || 50}</span>
                  </div>
                )}
              </div>
            </div>
            
            {isOpen ? (
              <ChevronUp className="w-5 h-5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
            )}
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="border-t border-border/50 pt-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Legs ({parlay.legs_hit || 0} hit / {parlay.legs_missed || 0} missed)
              </div>
              
              {legs.map((leg, idx) => (
                <div
                  key={leg.id || idx}
                  className={cn(
                    "flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30",
                    getLegOutcomeStyle(leg.outcome)
                  )}
                >
                  <div className="flex-1">
                    <div className="font-medium text-sm">
                      {leg.player_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {leg.prop_type} {leg.side.toUpperCase()} {leg.line} • {leg.team_name}
                    </div>
                  </div>
                  
                  <div className="text-right shrink-0">
                    <div className="text-xs">
                      <Badge variant="outline" className="text-xs h-5">
                        {leg.category}
                      </Badge>
                    </div>
                    {leg.actual_value !== undefined && (
                      <div className="text-xs mt-1">
                        Actual: {leg.actual_value}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {/* Strategy Info */}
              <div className="text-xs text-muted-foreground pt-2 border-t border-border/50 mt-3">
                Strategy: {parlay.strategy_name} v{parlay.strategy_version || 1}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
