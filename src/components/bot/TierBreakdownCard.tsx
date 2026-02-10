/**
 * TierBreakdownCard.tsx
 * 
 * Shows today's parlay distribution by tier with expandable details.
 */

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, Layers, FlaskConical, CheckCircle2, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BotParlay } from '@/hooks/useBotEngine';

interface TierBreakdownCardProps {
  parlays: BotParlay[];
}

const TIER_CONFIG = {
  exploration: {
    icon: FlaskConical,
    label: 'Exploration',
    description: 'Edge discovery, $0 stake',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
  },
  validation: {
    icon: CheckCircle2,
    label: 'Validation',
    description: 'Pattern confirmation, simulated',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
  },
  execution: {
    icon: Rocket,
    label: 'Execution',
    description: 'Best bets, Kelly stakes',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/20',
  },
};

export function TierBreakdownCard({ parlays }: TierBreakdownCardProps) {
  const [expandedTier, setExpandedTier] = useState<string | null>(null);

  // Group parlays by tier
  const tierGroups = parlays.reduce((acc, parlay) => {
    const sn = (parlay.strategy_name || '').toLowerCase();
    const tier = sn.includes('exploration') ? 'exploration' : sn.includes('validation') ? 'validation' : 'execution';
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(parlay);
    return acc;
  }, {} as Record<string, BotParlay[]>);

  // Calculate tier stats
  const tierStats = Object.entries(TIER_CONFIG).map(([tier, config]) => {
    const tierParlays = tierGroups[tier] || [];
    const pending = tierParlays.filter(p => p.outcome === 'pending').length;
    const won = tierParlays.filter(p => p.outcome === 'won').length;
    const lost = tierParlays.filter(p => p.outcome === 'lost').length;
    
    const legDistribution = tierParlays.reduce((acc, p) => {
      acc[p.leg_count] = (acc[p.leg_count] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    return {
      tier,
      config,
      count: tierParlays.length,
      pending,
      won,
      lost,
      parlays: tierParlays,
      legDistribution,
    };
  });

  const totalParlays = parlays.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="w-5 h-5" />
            Tier Breakdown
          </CardTitle>
          <Badge variant="outline">
            {totalParlays} total
          </Badge>
        </div>
        <CardDescription>
          Today's parlays organized by generation tier
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tierStats.map(({ tier, config, count, pending, won, lost, parlays: tierParlays, legDistribution }) => {
          const Icon = config.icon;
          const isExpanded = expandedTier === tier;
          
          return (
            <Collapsible key={tier} open={isExpanded} onOpenChange={() => setExpandedTier(isExpanded ? null : tier)}>
              <div className={cn(
                'rounded-lg border p-3',
                config.bgColor,
                config.borderColor
              )}>
                <CollapsibleTrigger asChild>
                  <Button 
                    variant="ghost" 
                    className="w-full justify-between p-0 h-auto hover:bg-transparent"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn('p-2 rounded-lg bg-background/50', config.color)}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="text-left">
                        <p className="font-medium">{config.label}</p>
                        <p className="text-xs text-muted-foreground">{config.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-bold">{count}</p>
                        <div className="flex gap-1 text-xs">
                          {pending > 0 && <span className="text-muted-foreground">{pending}⏳</span>}
                          {won > 0 && <span className="text-green-500">{won}✓</span>}
                          {lost > 0 && <span className="text-red-500">{lost}✗</span>}
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </Button>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                    {/* Leg distribution */}
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(legDistribution).map(([legs, legCount]) => (
                        <Badge key={legs} variant="secondary" className="text-xs">
                          {legs}-leg: {legCount}
                        </Badge>
                      ))}
                    </div>
                    
                    {/* Top parlays preview */}
                    {tierParlays.slice(0, 3).map((parlay, idx) => (
                      <div key={parlay.id} className="p-2 rounded bg-background/50 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            #{idx + 1} • {parlay.leg_count}-leg {parlay.strategy_name?.split('_').pop()}
                          </span>
                          <Badge 
                            variant={
                              parlay.outcome === 'won' ? 'default' :
                              parlay.outcome === 'lost' ? 'destructive' : 'secondary'
                            }
                            className="text-xs"
                          >
                          {parlay.outcome === 'pending' ? `+${parlay.expected_odds}` : parlay.outcome}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground mt-1 truncate">
                          {parlay.legs?.slice(0, 2).map(l => l.player_name || (l as any).home_team || 'Team').join(', ')}
                          {parlay.legs?.length > 2 && ` +${parlay.legs.length - 2} more`}
                        </p>
                      </div>
                    ))}
                    
                    {tierParlays.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center">
                        +{tierParlays.length - 3} more parlays
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
        
        {totalParlays === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No parlays generated yet</p>
            <p className="text-sm">Click "Generate Parlays" to create tiered picks</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
